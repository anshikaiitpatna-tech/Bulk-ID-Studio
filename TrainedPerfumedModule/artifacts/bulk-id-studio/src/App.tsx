import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, CircleHelp, CloudUpload, Download, FileArchive, FileSpreadsheet, FileText, Image as ImageIcon, Layers3, LoaderCircle, MoreHorizontal, Play, Printer, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Upload, X, Zap } from 'lucide-react';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { Route, Switch } from 'wouter';
import {
  type FieldMapping,
  type GeneratedCard,
  type GenerationIssue,
  type ParsedTemplate,
  type PhotoArchive,
  type SpreadsheetData,
  type SpreadsheetRow,
  fileToDataUrl,
  parsePhotoArchive,
  parseSpreadsheet,
  parseSvgTemplate,
  renderSvgForRow,
  renderSvgToPng,
  resolvePhotoData,
  rowLabel,
} from '@/lib/studio';
import '@/index.css';

type Step = 'Upload' | 'Map fields' | 'Review' | 'Export';

const steps: Step[] = ['Upload', 'Map fields', 'Review', 'Export'];
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

function suggestMappings(template: ParsedTemplate, spreadsheet: SpreadsheetData | null): FieldMapping {
  if (!spreadsheet) return {};
  return Object.fromEntries(template.tokens.map((token) => {
    const tokenKey = normalize(token);
    const header = spreadsheet.headers.find((candidate) => {
      const key = normalize(candidate);
      if (key === tokenKey) return true;
      if (tokenKey === 'photo') return ['photo', 'photourl', 'image', 'imageurl', 'filename', 'photofilename'].includes(key);
      return key.includes(tokenKey) || tokenKey.includes(key);
    });
    return [token, header ?? ''];
  }));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' }) {
  const colors = { neutral: 'bg-[#f1f5ef] text-[#60746b]', green: 'bg-[#dcecdf] text-[#367058]', amber: 'bg-[#fff1d8] text-[#946b36]', red: 'bg-[#f9e2dd] text-[#9c4e42]' };
  return <span className={`mono inline-flex items-center rounded px-2 py-1 text-[10px] uppercase tracking-[.08em] ${colors[tone]}`}>{children}</span>;
}

function UploadZone({ kind, accept, icon: Icon, title, detail, onFile, fileName }: { kind: string; accept: string; icon: typeof Upload; title: string; detail: string; onFile: (file: File) => void; fileName?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };
  return (
    <div
      className={`group rounded-xl border border-dashed p-4 transition-colors ${dragging ? 'border-[#1e5651] bg-[#e6f1e7]' : 'border-[#b9cbbd] bg-[#f4f8f1] hover:border-[#7ea995]'}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      data-testid={`upload-zone-${kind}`}
    >
      <input ref={inputRef} className="hidden" type="file" accept={accept} onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); }} data-testid={`input-file-${kind}`} />
      <button type="button" className="w-full text-left" onClick={() => inputRef.current?.click()} data-testid={`button-choose-${kind}`}>
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#dcebdd] text-[#1e5651]"><Icon size={18} strokeWidth={1.7} /></span>
          <span className="min-w-0">
            <span className="block text-[11px] font-extrabold tracking-[-.01em] text-[#172526]">{fileName ?? title}</span>
            <span className="mono mt-1 block truncate text-[9px] text-[#71807d]">{fileName ? 'Replace file · click to choose another' : detail}</span>
          </span>
          <Upload className="ml-auto text-[#8aa096] transition-transform group-hover:-translate-y-0.5" size={15} />
        </div>
      </button>
    </div>
  );
}

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`overflow-hidden rounded-xl border border-[#dce6df] bg-[#fffdf8] ${className}`}>{children}</section>;
}

function PanelHead({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 border-b border-[#e7eee8] px-4 py-3.5 sm:px-5"><div><div className="mono text-[9px] uppercase tracking-[.16em] text-[#84948c]">{eyebrow}</div><h2 className="mt-1 text-[13px] font-extrabold tracking-[-.025em] text-[#172526]">{title}</h2></div>{action}</div>;
}

function StepTracker({ step, canMap, canReview, canExport, onStep }: { step: Step; canMap: boolean; canReview: boolean; canExport: boolean; onStep: (step: Step) => void }) {
  const allowed = { Upload: true, 'Map fields': canMap, Review: canReview, Export: canExport };
  const activeIndex = steps.indexOf(step);
  return (
    <nav className="rounded-xl border border-[#dce6df] bg-[#fffdf8] px-4 py-3 sm:px-5" aria-label="Generation steps">
      <div className="grid grid-cols-4 gap-2">
        {steps.map((item, index) => (
          <div className={`flex min-w-0 items-center gap-2 text-[10px] font-bold ${item === step ? 'text-[#1e5651]' : index < activeIndex ? 'text-[#56806c]' : 'text-[#a3afaa]'}`} key={item}>
            <button type="button" disabled={!allowed[item]} onClick={() => onStep(item)} className="flex min-w-0 items-center gap-2 text-left" data-testid={`button-step-${normalize(item)}`}>
              <span className={`mono grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[10px] ${item === step ? 'border-[#1e5651] bg-[#1e5651] text-[#f6fbf5]' : index < activeIndex ? 'border-[#c6dfcd] bg-[#dbece0] text-[#3d755b]' : 'border-[#c9d6cf] bg-[#fbfcf8]'}`}>{index < activeIndex ? <Check size={12} /> : index + 1}</span>
              <span className="truncate">{item}</span>
            </button>
            {index < 3 && <span className="hidden h-px flex-1 bg-[#e2e8e1] sm:block" />}
          </div>
        ))}
      </div>
    </nav>
  );
}

function EmptyCanvas({ copy }: { copy: string }) {
  return <div className="flex min-h-[315px] flex-col items-center justify-center bg-[#edf3eb] px-8 text-center" style={{ backgroundImage: 'linear-gradient(#d8e5d9 1px,transparent 1px),linear-gradient(90deg,#d8e5d9 1px,transparent 1px)', backgroundSize: '24px 24px' }}><div className="grid h-12 w-12 place-items-center rounded-xl border border-[#c8d9ca] bg-[#f8fbf5] text-[#719681]"><Layers3 size={21} strokeWidth={1.5} /></div><h3 className="mt-4 text-sm font-extrabold text-[#36534b]">Your card canvas is waiting</h3><p className="mt-1 max-w-xs text-[11px] leading-5 text-[#71877d]">{copy}</p></div>;
}

function QualityRow({ icon: Icon, title, detail, count, tone = 'green' }: { icon: typeof Check; title: string; detail: string; count: string; tone?: 'green' | 'amber' }) {
  return <div className="flex items-center gap-2.5 rounded-lg bg-[#f5f8f3] p-2.5" data-testid={`status-${normalize(title)}`}><Icon size={16} className={tone === 'amber' ? 'text-[#b27b42]' : 'text-[#608f70]'} /><div className="min-w-0"><strong className="block text-[11px] text-[#263b36]">{title}</strong><span className="block truncate text-[9px] text-[#71807d]">{detail}</span></div><span className="mono ml-auto text-[11px] text-[#1e5651]">{count}</span></div>;
}

function BulkIdStudio() {
  const [step, setStep] = useState<Step>('Upload');
  const [template, setTemplate] = useState<ParsedTemplate | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [spreadsheet, setSpreadsheet] = useState<SpreadsheetData | null>(null);
  const [spreadsheetName, setSpreadsheetName] = useState('');
  const [archive, setArchive] = useState<PhotoArchive>();
  const [archiveName, setArchiveName] = useState('');
  const [mappings, setMappings] = useState<FieldMapping>({});
  const [selectedRow, setSelectedRow] = useState(0);
  const [search, setSearch] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [generatedCards, setGeneratedCards] = useState<GeneratedCard[]>([]);
  const [generationIssues, setGenerationIssues] = useState<GenerationIssue[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [cardsPerPage, setCardsPerPage] = useState<4 | 9>(4);
  const [margin, setMargin] = useState(6);
  const [bleed, setBleed] = useState(0);
  const [photoCache, setPhotoCache] = useState<Record<string, string>>({});
  const [photoResolution, setPhotoResolution] = useState<Record<string, boolean>>({});
  const [photoResolutionReady, setPhotoResolutionReady] = useState(false);
  const [checkingPhotos, setCheckingPhotos] = useState(false);
  const photoCacheRef = useRef<Record<string, string>>({});
  const noticeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    document.title = 'Bulk ID Studio — press-ready cards';
    const description = document.querySelector('meta[name="description"]') ?? document.createElement('meta');
    description.setAttribute('name', 'description');
    description.setAttribute('content', 'Turn one SVG card template and a spreadsheet into press-ready identity cards in bulk.');
    document.head.appendChild(description);
  }, []);

  const flash = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 2800);
  };

  const handleTemplate = async (file: File) => {
    setError('');
    if (!file.name.toLowerCase().endsWith('.svg')) { setError('Please choose one SVG template file.'); return; }
    try {
      const parsed = parseSvgTemplate(await file.text());
      setTemplate(parsed);
      setTemplateName(file.name);
      setSelectedRow(0);
      setGeneratedCards([]);
      setGenerationIssues([]);
      setMappings(spreadsheet ? suggestMappings(parsed, spreadsheet) : {});
      if (spreadsheet) setStep('Map fields');
      flash(`${parsed.tokens.length} template field${parsed.tokens.length === 1 ? '' : 's'} detected.`);
    } catch { setError('This SVG could not be read. Try exporting it as plain SVG.'); }
  };

  const handleSpreadsheet = async (file: File) => {
    setError('');
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) { setError('Please choose a CSV or XLSX spreadsheet.'); return; }
    try {
      const parsed = await parseSpreadsheet(file);
      setSpreadsheet(parsed);
      setSpreadsheetName(file.name);
      setGeneratedCards([]);
      setGenerationIssues([]);
      if (template) {
        setMappings(suggestMappings(template, parsed));
        setStep('Map fields');
      }
      flash(`${parsed.rows.length} row${parsed.rows.length === 1 ? '' : 's'} imported.`);
    } catch { setError('The spreadsheet could not be parsed. Check that the first row contains headers.'); }
  };

  const handleArchive = async (file: File) => {
    setError('');
    if (!file.name.toLowerCase().endsWith('.zip')) { setError('Photo matching accepts a ZIP of PNG, JPG, or WEBP images.'); return; }
    try {
      const parsed = await parsePhotoArchive(file);
      setArchive(parsed);
      setArchiveName(file.name);
      setGeneratedCards([]);
      flash(`${parsed.names.length} photo${parsed.names.length === 1 ? '' : 's'} indexed from ZIP.`);
    } catch { setError('The photo ZIP could not be opened.'); }
  };

  const rows = spreadsheet?.rows ?? [];
  const mappedCount = template?.tokens.filter((token) => Boolean(mappings[token] && mappings[token] !== '__ignore__')).length ?? 0;
  const photoToken = template?.tokens.find((token) => normalize(token) === 'photo');
  const photoHeader = photoToken ? mappings[photoToken] : '';

  useEffect(() => {
    if (!spreadsheet || !template?.photoPlaceholder || !photoToken || !photoHeader) {
      setPhotoResolution({});
      setPhotoResolutionReady(!template?.photoPlaceholder);
      setCheckingPhotos(false);
      return;
    }
    let cancelled = false;
    setCheckingPhotos(true);
    setPhotoResolutionReady(false);
    const checkPhotos = async () => {
      const results = await Promise.all(spreadsheet.rows.map(async (row, index) => {
        const value = String(row[photoHeader] ?? '').trim();
        const key = `${index}:${value}`;
        const embedded = spreadsheet.embeddedPhotos?.[index];
        if (embedded) return [key, true] as const;
        if (!value) return [key, false] as const;
        const resolved = await resolvePhotoData(value, archive);
        return [key, Boolean(resolved)] as const;
      }));
      if (cancelled) return;
      setPhotoResolution(Object.fromEntries(results));
      setPhotoResolutionReady(true);
      setCheckingPhotos(false);
    };
    void checkPhotos();
    return () => {
      cancelled = true;
    };
  }, [spreadsheet, template, photoToken, photoHeader, archive]);

  const photoIsResolved = (row: SpreadsheetRow, index: number) => {
    if (spreadsheet?.embeddedPhotos?.[index]) return true;
    const value = String(photoHeader ? row[photoHeader] ?? '' : '').trim();
    if (!value) return false;
    if (archive?.files[value.toLowerCase()] || archive?.files[value.split('/').pop()?.toLowerCase() ?? '']) return true;
    return photoResolution[`${index}:${value}`] === true;
  };

  const qualityIssues = useMemo(() => {
    if (!spreadsheet || !template) return [];
    const issues: GenerationIssue[] = [];
    spreadsheet.rows.forEach((row, index) => {
      template.tokens.forEach((token) => {
        const header = mappings[token];
        if (token !== photoToken && (!header || header === '__ignore__' || !String(row[header] ?? '').trim())) issues.push({ row: index + 1, field: token, message: header ? `${token} is empty` : `${token} has no mapped column`, person: rowLabel(row, mappings, index) });
      });
      if (photoToken && template.photoPlaceholder) {
        const value = photoHeader ? row[photoHeader] ?? '' : '';
        const resolved = photoIsResolved(row, index);
        const embedded = spreadsheet.embeddedPhotos?.[index];
        if (!embedded && (!photoHeader || !value)) {
          issues.push({ row: index + 1, field: 'Photo', message: photoHeader ? 'photo value is empty' : 'Photo has no mapped column', person: rowLabel(row, mappings, index) });
        } else if (!embedded && photoResolutionReady && !resolved) {
          issues.push({ row: index + 1, field: 'Photo', message: 'photo could not be matched', person: rowLabel(row, mappings, index) });
        }
      }
    });
    return issues;
  }, [spreadsheet, template, mappings, photoToken, photoHeader, archive, photoResolution, photoResolutionReady]);

  const issues = useMemo(() => {
    const all = [...qualityIssues, ...generationIssues];
    return all.filter((issue, index, list) => list.findIndex((candidate) => candidate.row === issue.row && candidate.field === issue.field && candidate.message === issue.message) === index);
  }, [qualityIssues, generationIssues]);
  const matchedPhotoCount = useMemo(() => {
    if (!spreadsheet || !photoHeader) return 0;
    return spreadsheet.rows.filter((row, index) => photoIsResolved(row, index)).length;
  }, [spreadsheet, photoHeader, archive, photoResolution, photoCache]);
  const validIndexes = useMemo(() => rows.map((_, index) => index).filter((index) => !qualityIssues.some((issue) => issue.row === index + 1)), [rows, qualityIssues]);
  const filteredIndexes = useMemo(() => validIndexes.filter((index) => rowLabel(rows[index], mappings, index).toLowerCase().includes(search.toLowerCase())), [validIndexes, rows, mappings, search]);
  const activeRow = rows[selectedRow];
  const hasMappings = Boolean(template && spreadsheet && template.tokens.length > 0 && template.tokens.every((token) => mappings[token] && mappings[token] !== '__ignore__'));
  const canMap = Boolean(template && spreadsheet);
  const canExport = generatedCards.length > 0;
  const canGenerate = Boolean(canMap && hasMappings && rows.length > 0 && !checkingPhotos);
  const canReview = canExport;

  useEffect(() => {
    if (!activeRow || !template) { setPreviewUrl(''); return; }
    let cancelled = false;
    const draw = async () => {
      try {
        const photoValue = photoToken && photoHeader ? activeRow[photoHeader] ?? '' : '';
        const cacheKey = `${selectedRow}:${photoValue}`;
        let photoData: string | undefined = photoCacheRef.current[cacheKey];
        if (!photoData) {
          const embedded = spreadsheet?.embeddedPhotos?.[selectedRow];
          if (embedded) photoData = await fileToDataUrl(embedded);
        }
        if (!photoData && photoValue) {
          photoData = await resolvePhotoData(photoValue, archive);
          if (photoData) {
            photoCacheRef.current[cacheKey] = photoData;
            setPhotoCache((current) => ({ ...current, [cacheKey]: photoData as string }));
          }
        }
        const svg = renderSvgForRow(template, activeRow, mappings, photoData);
        const blob = await renderSvgToPng(svg, 2);
        if (!cancelled) setPreviewUrl(URL.createObjectURL(blob));
      } catch { if (!cancelled) setPreviewUrl(''); }
    };
    void draw();
    return () => { cancelled = true; };
  }, [activeRow, template, mappings, photoToken, photoHeader, archive, selectedRow]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const updateMapping = (token: string, header: string) => {
    setMappings((current) => ({ ...current, [token]: header }));
    setGeneratedCards([]);
    setGenerationIssues([]);
    flash(`${token} mapped to ${header}.`);
  };

  const renderCard = async (rowIndex: number): Promise<GeneratedCard | null> => {
    if (!template || !spreadsheet) return null;
    const row = spreadsheet.rows[rowIndex];
    const photoValue = photoToken && photoHeader ? row[photoHeader] ?? '' : '';
    const cacheKey = `${rowIndex}:${photoValue}`;
    let photoData: string | undefined = photoCacheRef.current[cacheKey];
    if (!photoData) {
      const embedded = spreadsheet.embeddedPhotos?.[rowIndex];
      if (embedded) photoData = await fileToDataUrl(embedded);
    }
    if (!photoData && photoValue) {
      photoData = await resolvePhotoData(photoValue, archive);
      if (photoData) {
        photoCacheRef.current[cacheKey] = photoData;
        setPhotoCache((current) => ({ ...current, [cacheKey]: photoData as string }));
      }
    }
    if (photoToken && template.photoPlaceholder && !photoData) {
      const issue = { row: rowIndex + 1, field: 'Photo', message: 'photo could not be resolved during rendering', person: rowLabel(row, mappings, rowIndex) };
      setGenerationIssues((current) => [...current, issue]);
      return null;
    }
    const svgText = renderSvgForRow(template, row, mappings, photoData);
    const pngBlob = await renderSvgToPng(svgText, 3);
    return { rowIndex, pngBlob, svgText };
  };

  const generate = async (allRows: boolean) => {
    if (!canGenerate || isGenerating) return;
    if (!validIndexes.length) { setError('There are no valid rows yet. Resolve the quality issues before generating.'); return; }
    setError('');
    setIsGenerating(true);
    setProgress(0);
    setGenerationIssues([]);
    const targets = allRows ? validIndexes : validIndexes.slice(0, 5);
    const result: GeneratedCard[] = [];
    for (let index = 0; index < targets.length; index += 1) {
      const card = await renderCard(targets[index]);
      if (card) result.push(card);
      setProgress(Math.round(((index + 1) / targets.length) * 100));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    setGeneratedCards(allRows ? result : result);
    setIsGenerating(false);
    if (result.length) {
      setStep(allRows ? 'Export' : 'Review');
      flash(allRows ? `${result.length} cards rendered and ready to export.` : `${result.length} preview cards rendered.`);
    } else setError('No cards could be rendered. Resolve the issues in the quality panel and try again.');
  };

  const exportZip = async () => {
    if (!generatedCards.length) return;
    const zip = new JSZip();
    generatedCards.forEach((card, index) => {
      zip.file(`card-${String(card.rowIndex + 1).padStart(4, '0')}.png`, card.pngBlob);
      zip.file(`card-${String(card.rowIndex + 1).padStart(4, '0')}.svg`, card.svgText);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'bulk-id-studio-cards.zip');
    flash('Card ZIP downloaded.');
  };

  const exportPdf = async () => {
    if (!generatedCards.length) return;
    const pdf = await PDFDocument.create();
    const pageWidth = 612;
    const pageHeight = 792;
    const mm = (value: number) => value * 2.83465;
    const marginPt = mm(margin);
    const bleedPt = mm(bleed);
    const columns = cardsPerPage === 4 ? 2 : 3;
    const rowsOnPage = cardsPerPage === 4 ? 2 : 3;
    const gap = mm(5);
    const cr80Ratio = 85.6 / 53.98;
    const availableWidth = pageWidth - marginPt * 2 - gap * (columns - 1);
    const cardWidth = availableWidth / columns;
    const cardHeight = cardWidth / cr80Ratio;
    const totalHeight = cardHeight * rowsOnPage + gap * (rowsOnPage - 1);
    for (let offset = 0; offset < generatedCards.length; offset += cardsPerPage) {
      const page = pdf.addPage([pageWidth, pageHeight]);
      const pageCards = generatedCards.slice(offset, offset + cardsPerPage);
      await Promise.all(pageCards.map(async (card, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const image = await pdf.embedPng(await card.pngBlob.arrayBuffer());
        page.drawImage(image, { x: marginPt + col * (cardWidth + gap) - bleedPt, y: pageHeight - marginPt - totalHeight + (rowsOnPage - 1 - row) * (cardHeight + gap) - bleedPt, width: cardWidth + bleedPt * 2, height: cardHeight + bleedPt * 2 });
      }));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    const pdfBytes = await pdf.save();
    const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
    new Uint8Array(pdfBuffer).set(pdfBytes);
    const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
    downloadBlob(blob, `bulk-id-studio-${cardsPerPage}up.pdf`);
    flash('Print PDF downloaded.');
  };

  const resetStudio = () => {
    setTemplate(null); setTemplateName(''); setSpreadsheet(null); setSpreadsheetName(''); setArchive(undefined); setArchiveName(''); setMappings({}); setGeneratedCards([]); setGenerationIssues([]); setSelectedRow(0); setStep('Upload'); setError(''); setProgress(0); photoCacheRef.current = {}; setPhotoCache({});
    flash('Studio cleared.');
  };

  return (
    <main className="studio-noise min-h-[100dvh] bg-[#f7f8f4] px-3 py-5 text-[#172526] sm:px-6 sm:py-7 lg:px-8">
      <div className="mx-auto max-w-[1480px]">
        <header className="flex flex-col justify-between gap-5 pb-5 md:flex-row md:items-start">
          <div><div className="mono mb-2 text-[10px] uppercase tracking-[.18em] text-[#7c9187]">BULK ID STUDIO / PRINT WORKSPACE</div><h1 className="text-[27px] font-extrabold leading-tight tracking-[-.055em] sm:text-[31px]">One template. Every card.</h1><p className="mt-2 max-w-xl text-[12px] leading-5 text-[#71807d]">A quiet, dependable path from SVG and spreadsheet to press-ready identity cards.</p></div>
          <div className="flex items-center gap-2">
            <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-[#dce6df] bg-[#fffdf8] px-3 py-2 text-[10px] font-bold text-[#5a6f66] transition-transform hover:-translate-y-0.5" onClick={() => flash('Your batch stays in this browser until you download it.')} data-testid="button-autosave"><CloudUpload size={14} /> Local workspace</button>
            <button type="button" aria-label="Studio settings" className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce6df] bg-[#fffdf8] text-[#60746b]" onClick={() => flash('Print settings are available in Export.')} data-testid="button-settings"><Settings2 size={15} /></button>
            <button type="button" aria-label="Help" className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce6df] bg-[#fffdf8] text-[#60746b]" onClick={() => flash('Use {{Token}} text in your SVG, then map each token to a column.')} data-testid="button-help"><CircleHelp size={15} /></button>
          </div>
        </header>

        <StepTracker step={step} canMap={canMap} canReview={canReview} canExport={canExport} onStep={(next) => setStep(next)} />

        {(error || notice) && <div className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[11px] ${error ? 'border-[#efd3ca] bg-[#fff3ef] text-[#8c5148]' : 'border-[#d4e5d5] bg-[#eef7ed] text-[#47745f]'}`} role="status" data-testid={error ? 'status-error' : 'status-notice'}>{error ? <AlertTriangle size={14} /> : <Check size={14} />}{error || notice}{error && <button type="button" className="ml-auto" onClick={() => setError('')} aria-label="Dismiss error" data-testid="button-dismiss-error"><X size={14} /></button>}</div>}

        <section className="mt-4 grid items-start gap-3 lg:grid-cols-[290px_minmax(400px,1fr)_320px]">
          <aside className="space-y-3">
            <Panel>
              <PanelHead eyebrow="Source files" title="Batch ingredients" action={<button type="button" aria-label="Clear workspace" className="grid h-7 w-7 place-items-center rounded-md border border-[#dce6df] text-[#7d9187]" onClick={resetStudio} data-testid="button-clear-workspace"><MoreHorizontal size={14} /></button>} />
              <div className="space-y-2.5 p-4 sm:p-5">
                <UploadZone kind="template" accept=".svg,image/svg+xml" icon={FileText} title="Add SVG template" detail="SVG only · one card face" onFile={handleTemplate} fileName={templateName} />
                <UploadZone kind="spreadsheet" accept=".csv,.xlsx,.xls,text/csv" icon={FileSpreadsheet} title="Add spreadsheet" detail="CSV or XLSX · first row = headers" onFile={handleSpreadsheet} fileName={spreadsheetName} />
                <UploadZone kind="photos" accept=".zip,application/zip" icon={FileArchive} title="Add photo ZIP" detail="Optional · PNG, JPG, WEBP" onFile={handleArchive} fileName={archiveName} />
                {template && <div className="border-t border-[#e7eee8] pt-4"><div className="mono text-[9px] uppercase tracking-[.12em] text-[#84948c]">Detected fields <span className="text-[#58816d]">· {template.tokens.length}</span></div>{template.tokens.length ? <div className="mt-2 flex flex-wrap gap-1.5">{template.tokens.map((token) => <span className="mono rounded border border-[#cadfd0] bg-[#f0f7ef] px-2 py-1 text-[9px] text-[#3f685f]" key={token} data-testid={`text-token-${normalize(token)}`}>{`{{${token}}}`}</span>)}</div> : <p className="mt-2 text-[10px] text-[#8a6d4b]">No {'{{Token}}'} fields found in this SVG.</p>}{template.photoPlaceholder && <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[#56806c]"><ImageIcon size={13} /> Photo bounds detected</div>}</div>}
                {!template && !spreadsheet && <div className="flex gap-2 rounded-lg border border-[#f0dfb5] bg-[#fff8e9] p-2.5 text-[10px] leading-4 text-[#826b45]"><Sparkles className="mt-0.5 shrink-0" size={13} />Start with an SVG and spreadsheet. Your files are parsed locally in this browser.</div>}
              </div>
            </Panel>
            {step === 'Upload' && <Panel className="hidden lg:block"><div className="p-4"><div className="mono text-[9px] uppercase tracking-[.12em] text-[#84948c]">Workflow note</div><p className="mt-2 text-[11px] leading-5 text-[#667d70]">Nothing is generated until every field can be traced back to a source column.</p></div></Panel>}
          </aside>

          <section className="min-w-0">
            <Panel className="min-h-[580px]">
              <PanelHead eyebrow={`${step === 'Upload' ? 'Step 01' : step === 'Map fields' ? 'Step 02' : step === 'Review' ? 'Step 03' : 'Step 04'} / live workspace`} title={step === 'Upload' ? 'Bring in your source files' : step === 'Map fields' ? 'Map fields & preview cards' : step === 'Review' ? 'Review generated cards' : 'Package your press files'} action={template && spreadsheet ? <div className="flex items-center gap-2"><div className="hidden items-center gap-1.5 rounded-md border border-[#dce6df] bg-[#fcfdf9] px-2 py-1.5 text-[#9aa9a1] sm:flex"><Search size={12} /><input className="w-28 bg-transparent text-[10px] text-[#172526] outline-none" placeholder="Find a row…" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-search-rows" /></div><button type="button" className="grid h-8 w-8 place-items-center rounded-md border border-[#dce6df] text-[#6f857b]" onClick={() => { setGeneratedCards([]); flash('Preview refreshed.'); }} aria-label="Refresh preview" data-testid="button-refresh-preview"><RefreshCw size={13} /></button></div> : undefined} />
               {!template || !spreadsheet ? <EmptyCanvas copy="Upload the SVG face and the spreadsheet on the left. Once both are present, the live canvas will use your actual row data." /> : !hasMappings ? <div className="flex min-h-[315px] flex-col items-center justify-center bg-[#edf3eb] px-8 text-center" data-testid="empty-mapping-state"><div className="grid h-12 w-12 place-items-center rounded-xl border border-[#c8d9ca] bg-[#f8fbf5] text-[#719681]"><ArrowRight size={21} /></div><h3 className="mt-4 text-sm font-extrabold text-[#36534b]">Map your fields to see the card</h3><p className="mt-1 max-w-xs text-[11px] leading-5 text-[#71877d]">Choose a spreadsheet column for every detected token. The preview updates as soon as the mapping is complete.</p><button type="button" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#1e5651] px-3 py-2 text-[10px] font-extrabold text-[#f6fbf5] shadow-[0_3px_0_#123c38] transition-transform hover:-translate-y-0.5" onClick={() => setStep('Map fields')} data-testid="button-open-mapping"><ArrowRight size={13} /> Open field mapping</button></div> : previewUrl ? <div className="relative flex min-h-[315px] items-center justify-center overflow-hidden bg-[#edf3eb] p-6" style={{ backgroundImage: 'linear-gradient(#d8e5d9 1px,transparent 1px),linear-gradient(90deg,#d8e5d9 1px,transparent 1px)', backgroundSize: '24px 24px' }}><span className="mono absolute left-3 top-3 text-[9px] text-[#789087]">SVG CANVAS / ROW {selectedRow + 1}</span><img src={previewUrl} alt={`Rendered card for row ${selectedRow + 1}`} className="max-h-[390px] max-w-[72%] rounded-sm border border-[#d8d9cf] bg-[#fffdf7] shadow-[0_16px_32px_rgba(41,73,57,.15)]" data-testid="img-live-preview" /></div> : <div className="flex min-h-[315px] items-center justify-center bg-[#edf3eb]"><LoaderCircle className="spin text-[#4f806b]" size={24} /></div>}
              {template && spreadsheet && hasMappings && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e7eee8] px-4 py-3 text-[10px] text-[#73847b] sm:px-5"><span>Showing <strong className="text-[#172526]" data-testid="text-active-person">{activeRow ? rowLabel(activeRow, mappings, selectedRow) : '—'}</strong> · row <strong className="text-[#172526]">{Math.min(selectedRow + 1, rows.length)}</strong> of {rows.length}</span><div className="flex items-center gap-2"><span className="mono hidden text-[9px] sm:inline">CR80 · 85.6 × 53.98 mm</span><button type="button" className="grid h-7 w-7 place-items-center rounded-md border border-[#dce6df] bg-[#fbfcf8] text-[#60746b]" disabled={selectedRow <= 0} onClick={() => setSelectedRow((current) => Math.max(0, current - 1))} aria-label="Previous row" data-testid="button-previous-row"><ArrowLeft size={12} /></button><button type="button" className="grid h-7 w-7 place-items-center rounded-md border border-[#dce6df] bg-[#fbfcf8] text-[#60746b]" disabled={selectedRow >= rows.length - 1} onClick={() => setSelectedRow((current) => Math.min(rows.length - 1, current + 1))} aria-label="Next row" data-testid="button-next-row"><ArrowRight size={12} /></button></div></div>}
              {template && spreadsheet && <div className="border-b border-[#e7eee8] px-4 py-3 sm:px-5"><div className="flex items-center justify-between"><div><div className="mono text-[9px] uppercase tracking-[.12em] text-[#84948c]">Rendered gallery</div><h3 className="mt-1 text-[13px] font-extrabold text-[#172526]">{generatedCards.length ? `${generatedCards.length} actual PNG${generatedCards.length === 1 ? '' : 's'} generated` : 'First five valid rows'}</h3></div><Pill tone={generatedCards.length ? 'green' : 'neutral'}>{generatedCards.length ? `${generatedCards.length} ready` : `${validIndexes.length} valid`}</Pill></div>
                {generatedCards.length ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">{generatedCards.slice(0, 10).map((card) => <GalleryCard key={card.rowIndex} card={card} selected={card.rowIndex === selectedRow} onClick={() => setSelectedRow(card.rowIndex)} />)}</div> : <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">{filteredIndexes.slice(0, 5).map((index) => <button type="button" key={index} className={`rounded-lg border bg-[#fdfcf6] p-2 text-left transition-transform hover:-translate-y-0.5 ${selectedRow === index ? 'border-[#d88158] ring-1 ring-[#d88158]' : 'border-[#dce3da]'}`} onClick={() => setSelectedRow(index)} data-testid={`button-row-${index + 1}`}><div className="flex h-24 items-center justify-center rounded bg-[#edf3eb] text-[#7da18a]"><ImageIcon size={20} strokeWidth={1.5} /></div><span className="mt-1.5 block truncate text-[9px] font-bold text-[#60736a]">{rowLabel(rows[index], mappings, index)}</span><span className="mono block text-[8px] text-[#8a9b91]">row {index + 1}</span></button>)}</div>}</div>}
            </Panel>
          </section>

          <aside className="space-y-3">
            <Panel>
              <PanelHead eyebrow="Quality check" title="Before you generate" action={<ShieldCheck size={17} className={issues.length ? 'text-[#b27b42]' : 'text-[#5b8b70]'} />} />
              <div className="space-y-2 p-4 sm:p-5">
                <QualityRow icon={issues.some((issue) => issue.field !== 'Photo') ? AlertTriangle : Check} title="Fields mapped" detail={template ? `${mappedCount} of ${template.tokens.length} tokens have a source` : 'Upload a template first'} count={template ? `${mappedCount}/${template.tokens.length}` : '—'} tone={issues.some((issue) => issue.field !== 'Photo') ? 'amber' : 'green'} />
                 <QualityRow icon={ImageIcon} title="Photos matched" detail={template?.photoPlaceholder ? checkingPhotos ? 'Checking image sources…' : `${matchedPhotoCount} of ${rows.length} rows ready` : 'No photo placeholder detected'} count={template?.photoPlaceholder ? `${matchedPhotoCount}/${rows.length}` : '—'} tone={issues.some((issue) => issue.field === 'Photo') ? 'amber' : 'green'} />
                <QualityRow icon={Layers3} title="Rows imported" detail={spreadsheet ? 'Spreadsheet is ready' : 'Waiting for spreadsheet'} count={spreadsheet ? String(rows.length) : '—'} />
                {issues.length > 0 && <div className="rounded-lg border border-[#efd9b1] bg-[#fff9eb] p-3" data-testid="quality-issues"><div className="mb-2 flex items-center justify-between text-[#956c39]"><strong className="text-[11px]">{issues.length} item{issues.length === 1 ? '' : 's'} to resolve</strong><AlertTriangle size={14} /></div><ul className="m-0 grid max-h-44 gap-2 overflow-auto p-0">{issues.slice(0, 20).map((issue, index) => <li className="flex gap-1.5 text-[10px] leading-4 text-[#7d694b]" key={`${issue.row}-${issue.field}-${index}`}><AlertTriangle className="mt-0.5 shrink-0" size={11} /><span><strong>Row {issue.row} · {issue.person}</strong> — {issue.message}</span></li>)}</ul></div>}
                {template && spreadsheet && !issues.length && <div className="flex gap-2 rounded-lg border border-[#d4e5d5] bg-[#eef7ed] p-2.5 text-[10px] leading-4 text-[#47745f]" data-testid="status-quality-ready"><Check className="mt-0.5 shrink-0" size={13} />Every imported row is ready for rendering.</div>}
              </div>
            </Panel>

            <Panel>
              <PanelHead eyebrow="Field mapping" title="Spreadsheet → template" action={hasMappings ? <Pill tone="green">Synced</Pill> : <Pill>Required</Pill>} />
              <div className="p-4 sm:p-5">{template?.tokens.length ? template.tokens.map((token) => <div className="grid grid-cols-[1fr_15px_1.18fr] items-center gap-1.5 border-b border-[#edf1eb] py-2 last:border-0" key={token}><code className="mono truncate text-[10px] text-[#497267]">{`{{${token}}}`}</code><ArrowRight size={12} className="text-[#adc0b5]" /><select className="min-w-0 rounded-md border border-[#dce6df] bg-[#fbfcf8] px-1.5 py-1.5 text-[10px] text-[#465b56] outline-none focus:border-[#7ea995]" value={mappings[token] ?? ''} onChange={(event) => updateMapping(token, event.target.value)} disabled={!spreadsheet} aria-label={`Map ${token}`} data-testid={`select-mapping-${normalize(token)}`}><option value="">Choose column</option><option value="__ignore__">Ignore column</option>{spreadsheet?.headers.map((header) => <option value={header} key={header}>{header}</option>)}</select></div>) : <p className="text-[10px] leading-4 text-[#8a9b91]">Detected {'{{Token}}'} elements will appear here.</p>}</div>
            </Panel>

            <Panel className="bg-[#eef5ec]">
              <div className="p-4 sm:p-5"><div className="flex items-center gap-2"><Zap size={15} className="text-[#b8784f]" /><h2 className="text-[13px] font-extrabold text-[#263b36]">{canExport ? 'Batch is rendered' : 'Ready when you are'}</h2></div><p className="mt-2 text-[10px] leading-4 text-[#667d70]">{canExport ? 'Download the generated cards or lay them out for print.' : 'Generate five valid rows first. This catches layout and image issues before the full run.'}</p>{isGenerating && <div className="mt-3"><div className="mb-1 flex justify-between mono text-[9px] text-[#47745f]"><span>Rendering in browser</span><span>{progress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#d7e8d8]"><div className="h-full bg-[#4c806c] transition-[width] duration-200" style={{ width: `${progress}%` }} /></div></div>}<div className="mt-3 grid gap-2">{!canExport ? <button type="button" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1e5651] px-3 py-2.5 text-[11px] font-extrabold text-[#f6fbf5] shadow-[0_3px_0_#123c38] transition-transform hover:-translate-y-0.5 disabled:shadow-none" disabled={!canGenerate || isGenerating} onClick={() => void generate(false)} data-testid="button-generate-preview">{isGenerating ? <><LoaderCircle className="spin" size={14} /> Rendering {progress}%</> : <><Play size={14} /> Generate preview batch</>}</button> : <><button type="button" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1e5651] px-3 py-2.5 text-[11px] font-extrabold text-[#f6fbf5] shadow-[0_3px_0_#123c38] transition-transform hover:-translate-y-0.5 disabled:shadow-none" disabled={isGenerating || validIndexes.length === 0} onClick={() => void generate(true)} data-testid="button-generate-all">{isGenerating ? <><LoaderCircle className="spin" size={14} /> Rendering {progress}%</> : <><RefreshCw size={14} /> Generate all · {validIndexes.length}</>}</button><button type="button" className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#cddfd0] bg-[#fbfff9] px-3 py-2 text-[10px] font-bold text-[#4d7162]" onClick={() => void exportZip()} data-testid="button-export-zip"><Download size={13} /> Download PNG + SVG ZIP</button></>}</div></div>
            </Panel>
          </aside>
        </section>

        {step === 'Export' && canExport && <section className="mt-3 grid gap-3 lg:grid-cols-[1fr_320px]"><Panel><PanelHead eyebrow="Print output" title="Build a combined PDF" action={<Printer size={16} className="text-[#5b8b70]" />} /><div className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5"><label className="text-[10px] font-bold text-[#60746b]">Cards per page<select className="mt-1.5 block w-full rounded-md border border-[#dce6df] bg-[#fbfcf8] px-2 py-2 text-[11px] text-[#263b36] outline-none" value={cardsPerPage} onChange={(event) => setCardsPerPage(Number(event.target.value) as 4 | 9)} data-testid="select-cards-per-page"><option value="4">4-up · larger cards</option><option value="9">9-up · compact sheet</option></select></label><label className="text-[10px] font-bold text-[#60746b]">Margin · mm<input className="mt-1.5 block w-full rounded-md border border-[#dce6df] bg-[#fbfcf8] px-2 py-2 text-[11px] text-[#263b36] outline-none" type="number" min="0" max="30" value={margin} onChange={(event) => setMargin(Number(event.target.value))} data-testid="input-print-margin" /></label><label className="text-[10px] font-bold text-[#60746b]">Bleed · mm<input className="mt-1.5 block w-full rounded-md border border-[#dce6df] bg-[#fbfcf8] px-2 py-2 text-[11px] text-[#263b36] outline-none" type="number" min="0" max="10" step=".5" value={bleed} onChange={(event) => setBleed(Number(event.target.value))} data-testid="input-print-bleed" /></label></div></Panel><Panel className="bg-[#eef5ec]"><div className="p-4 sm:p-5"><div className="mono text-[9px] uppercase tracking-[.12em] text-[#71877d]">Export summary</div><div className="mt-2 text-2xl font-extrabold tracking-[-.05em] text-[#1e5651]" data-testid="text-export-count">{generatedCards.length}</div><p className="mt-1 text-[10px] leading-4 text-[#667d70]">Cards in the current browser batch. Generate all to include every valid row.</p><button type="button" className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#cddfd0] bg-[#fbfff9] px-3 py-2 text-[10px] font-bold text-[#4d7162]" onClick={() => void exportPdf()} data-testid="button-export-pdf"><Printer size={13} /> Export {cardsPerPage}-up print PDF</button></div></Panel></section>}
      </div>
      <div className="mx-auto mt-5 flex max-w-[1480px] items-center justify-between border-t border-[#dce6df] pt-3 text-[9px] text-[#84948c]"><span className="mono uppercase tracking-[.12em]">Local-first rendering · no upload</span><span>SVG · CSV / XLSX · ZIP · PDF</span></div>
    </main>
  );
}

function GalleryCard({ card, selected, onClick }: { card: GeneratedCard; selected: boolean; onClick: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(card.pngBlob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [card.pngBlob]);
  return <button type="button" className={`rounded-lg border bg-[#fdfcf6] p-2 text-left transition-transform hover:-translate-y-0.5 ${selected ? 'border-[#d88158] ring-1 ring-[#d88158]' : 'border-[#dce3da]'}`} onClick={onClick} data-testid={`button-generated-card-${card.rowIndex + 1}`}><div className="flex h-24 items-center justify-center rounded bg-[#edf3eb] p-1"><img src={url} alt={`Generated card row ${card.rowIndex + 1}`} className="h-full max-w-full object-contain" data-testid={`img-generated-card-${card.rowIndex + 1}`} /></div><span className="mono mt-1.5 block text-[8px] text-[#60736a]">row {card.rowIndex + 1}</span></button>;
}

function App() {
  return <Switch><Route path="/" component={BulkIdStudio} /><Route><div className="grid min-h-[100dvh] place-items-center bg-[#f7f8f4] text-sm text-[#172526]">Page not found.</div></Route></Switch>;
}

export default App;