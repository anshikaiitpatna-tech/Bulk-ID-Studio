import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

export type SpreadsheetRow = Record<string, string>;
export type PhotoArchive = { files: Record<string, File>; names: string[] };
export type PhotoPlaceholder = { x: number; y: number; width: number; height: number; source: string };
export type ParsedTemplate = { rawSvg: string; tokens: string[]; photoPlaceholder?: PhotoPlaceholder };
export type SpreadsheetData = { headers: string[]; rows: SpreadsheetRow[]; embeddedPhotos?: Record<number, File> };
export type FieldMapping = Record<string, string>;
export type GenerationIssue = { row: number; field: string; message: string; person?: string };
export type GeneratedCard = { rowIndex: number; pngBlob: Blob; svgText: string };

const cleanToken = (value: string) => value.trim().replace(/^\{\{|\}\}$/g, '').trim();
const baseName = (name: string) => name.split('/').pop()?.replace(/\.[^.]+$/, '').toLowerCase() ?? '';
const fileNameKey = (name: string) => name.split('/').pop()?.toLowerCase() ?? '';
const escapeXml = (value: string) => value.replace(/[<>&'"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] ?? character);

function numeric(value: string | null, fallback: number) {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Canva split tspans fix
function sanitizeCanvaSvg(rawSvg: string): string {
  let cleaned = rawSvg;
  // Merges tspans inside {{ ... }} tags split by Canva
  cleaned = cleaned.replace(/(<text[^>]*>)[\s\S]*?(<\/text>)/gi, (fullMatch) => {
    const textContentOnly = fullMatch.replace(/<[^>]+>/g, '');
    if (/\{\{[\s\S]*?\}\}/.test(textContentOnly)) {
      return fullMatch.replace(/<\/tspan>\s*<tspan[^>]*>/gi, '');
    }
    return fullMatch;
  });
  return cleaned;
}

export function parseSvgTemplate(rawSvg: string): ParsedTemplate {
  const sanitizedSvg = sanitizeCanvaSvg(rawSvg);
  const found = new Set<string>();

  for (const match of sanitizedSvg.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
    found.add(cleanToken(match[1]));
  }

  const doc = new DOMParser().parseFromString(sanitizedSvg, 'image/svg+xml');
  let photo: PhotoPlaceholder | undefined;
  const elements = Array.from(doc.querySelectorAll('*'));

  for (const element of elements) {
    const text = element.textContent?.trim() ?? '';
    const id = element.getAttribute('id')?.toLowerCase() ?? '';
    const placeholder = element.getAttribute('data-placeholder')?.toLowerCase() ?? '';
    const isPhotoToken = element.tagName.toLowerCase() === 'text' && /\{\{\s*photo\s*\}\}/i.test(text);
    
    // Automatic detection for Canva landscape image or photo placeholder
    const isImageElement = element.tagName.toLowerCase() === 'image';
    const isPhoto = id === 'photo-placeholder' || placeholder === 'photo' || isPhotoToken || isImageElement;
    
    if (!isPhoto) continue;

    found.add('Photo');
    const viewBox = doc.documentElement.getAttribute('viewBox')?.split(/\s+/).map(Number);
    const viewWidth = viewBox?.[2] ?? 640;
    const viewHeight = viewBox?.[3] ?? 900;
    const fallbackWidth = viewWidth * 0.28;
    const fallbackHeight = fallbackWidth / 0.72;
    const geometry =
      element.matches('rect, circle, ellipse, image') ? element : element.querySelector('rect, circle, ellipse, image');
    const xAttribute = geometry?.getAttribute('x');
    const yAttribute = geometry?.getAttribute('y');
    const widthAttribute = geometry?.getAttribute('width');
    const heightAttribute = geometry?.getAttribute('height');
    const radius = numeric(geometry?.getAttribute('r') ?? null, 0);
    const resolvedWidth = widthAttribute != null ? numeric(widthAttribute, fallbackWidth) : radius > 0 ? radius * 2 : fallbackWidth;
    const resolvedHeight = heightAttribute != null ? numeric(heightAttribute, fallbackHeight) : radius > 0 ? radius * 2 : fallbackHeight;
    const fallbackX = (viewWidth - resolvedWidth) / 2;
    const fallbackY = viewHeight * 0.22;
    const x = xAttribute != null ? numeric(xAttribute, fallbackX) : fallbackX;
    const y = yAttribute != null ? numeric(yAttribute, fallbackY) : fallbackY;
    photo = { x, y, width: resolvedWidth, height: resolvedHeight, source: geometry?.tagName.toLowerCase() ?? element.tagName.toLowerCase() };
    break;
  }

  if (!photo && found.has('Photo')) {
    const viewBox = doc.documentElement.getAttribute('viewBox')?.split(/\s+/).map(Number);
    photo = { x: (viewBox?.[2] ?? 640) / 2 - 60, y: (viewBox?.[3] ?? 900) / 2 - 75, width: 120, height: 150, source: 'token' };
  }

  return { rawSvg: sanitizedSvg, tokens: Array.from(found), photoPlaceholder: photo };
}

export async function parseSpreadsheet(file: File): Promise<SpreadsheetData> {
  if (file.name.toLowerCase().endsWith('.csv')) {
    const text = await file.text();
    const parsed = Papa.parse<SpreadsheetRow>(text, { header: true, skipEmptyLines: true, transformHeader: (header) => header.trim() });
    const rows = parsed.data.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? '').trim()])));
    const headers = parsed.meta.fields?.filter(Boolean) ?? Object.keys(rows[0] ?? {});
    return { headers, rows };
  }
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<SpreadsheetRow>(firstSheet, { defval: '', raw: false }).map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim(), String(value ?? '').trim()])),
  );

  const embeddedPhotos: Record<number, File> = {};
  try {
    const zip = await JSZip.loadAsync(buffer);
    const richXml = await zip.file('xl/richData/rdrichvalue.xml')?.async('text');
    const sheetXml = await zip.file('xl/worksheets/sheet1.xml')?.async('text');
    if (richXml && sheetXml) {
      const richDoc = new DOMParser().parseFromString(richXml, 'application/xml');
      const richValues = Array.from(richDoc.getElementsByTagNameNS('*', 'rv'));
      const sheetDoc = new DOMParser().parseFromString(sheetXml, 'application/xml');
      const cells = Array.from(sheetDoc.getElementsByTagNameNS('*', 'c'));
      const mediaFiles = new Set(Object.keys(zip.files).filter((name) => /^xl\/media\/image\d+\.(png|jpe?g|webp|gif)$/i.test(name)));

      for (const cell of cells) {
        const vm = cell.getAttribute('vm');
        const ref = cell.getAttribute('r');
        if (!vm || !ref || !/^[A-Z]+\d+$/.test(ref)) continue;
        const richIndex = Number(vm) - 1;
        if (!Number.isInteger(richIndex) || richIndex < 0 || richIndex >= richValues.length) continue;
        const rich = richValues[richIndex];
        const values = Array.from(rich.getElementsByTagNameNS('*', 'v')).map((node) => node.textContent ?? '');
        const localImageId = Number(values[0]);
        if (!Number.isInteger(localImageId)) continue;
        const mediaCandidates = Array.from(mediaFiles).filter((name) => Number(name.match(/image(\d+)\./i)?.[1]) === localImageId + 1);
        const mediaName = mediaCandidates[0];
        if (!mediaName) continue;
        const blob = await zip.file(mediaName)!.async('blob');
        const extension = mediaName.split('.').pop()?.toLowerCase() ?? 'png';
        const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : extension === 'gif' ? 'image/gif' : 'image/png';
        const rowNumber = Number(ref.match(/\d+$/)?.[0]);
        const dataRowIndex = rowNumber - 2;
        if (dataRowIndex >= 0 && dataRowIndex < rows.length) {
          embeddedPhotos[dataRowIndex] = new File([blob], mediaName.split('/').pop() ?? mediaName, { type: mime });
        }
      }
    }
  } catch {
    // Keep normal spreadsheet functional
  }

  return { headers: Object.keys(rows[0] ?? {}), rows, embeddedPhotos };
}

export async function parsePhotoArchive(file: File): Promise<PhotoArchive> {
  const zip = await JSZip.loadAsync(file);
  const files: Record<string, File> = {};
  const names: string[] = [];
  await Promise.all(Object.values(zip.files).filter((entry) => !entry.dir).map(async (entry) => {
    const name = entry.name;
    if (!/\.(png|jpe?g|webp|gif)$/i.test(name)) return;
    const blob = await entry.async('blob');
    const extension = name.split('.').pop()?.toLowerCase();
    const inferredType = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : 'image/png';
    const imageFile = new File([blob], name.split('/').pop() ?? name, { type: blob.type || inferredType });
    files[fileNameKey(name)] = imageFile;
    files[baseName(name)] = imageFile;
    names.push(name.split('/').pop() ?? name);
  }));
  return { files, names: names.sort() };
}

export function findPhoto(value: string, archive?: PhotoArchive): File | string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) return trimmed;
  if (!archive) return undefined;
  return archive.files[fileNameKey(trimmed)] ?? archive.files[baseName(trimmed)];
}

export async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}

export function rowLabel(row: SpreadsheetRow, mappings: FieldMapping, index: number) {
  const identityToken = Object.keys(mappings).find((token) => /name|person|student|roll|id|identifier/i.test(token) && mappings[token] && mappings[token] !== '__ignore__');
  const preferred = identityToken ? mappings[identityToken] : undefined;
  return (preferred && row[preferred]) || row.Name || row.name || row['Full name'] || row.ID || row.Id || `Row ${index + 1}`;
}

export function renderSvgForRow(template: ParsedTemplate, row: SpreadsheetRow, mappings: FieldMapping, photoData?: string) {
  let svg = template.rawSvg.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawToken: string) => {
    const token = cleanToken(rawToken);
    if (token.toLowerCase() === 'photo') return '';
    const header = mappings[token];
    return header && header !== '__ignore__' ? escapeXml(row[header] ?? '') : '';
  });

  if (template.photoPlaceholder && photoData) {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');

    const photoElement =
      doc.querySelector('#photo-placeholder') ||
      doc.querySelector('[data-placeholder="photo"]') ||
      doc.querySelector('image');

    if (photoElement) {
      /**
       * IMPORTANT:
       * Design tools like Figma/Illustrator/Canva almost always export a plain
       * placeholder shape as <rect>, <circle>, or <ellipse> — never as a real
       * <image> element, even if "Photo" is just a visual box in the design.
       * Setting `href` on a rect/circle/ellipse does nothing (SVG only renders
       * images through an <image> element), so the swapped photo would
       * silently fail to appear.
       *
       * To stay compatible with any template regardless of which tool
       * exported it, convert the placeholder into a real <image> element
       * (preserving its id/position/clip so it still lines up with the
       * design) before writing the photo into it.
       */
      let imageElement: Element = photoElement;

      if (photoElement.tagName.toLowerCase() !== 'image') {
        imageElement = doc.createElementNS('http://www.w3.org/2000/svg', 'image');

        const radius = numeric(photoElement.getAttribute('r'), 0);

        const x =
          photoElement.getAttribute('x') ??
          (radius > 0
            ? String(numeric(photoElement.getAttribute('cx'), 0) - radius)
            : String(template.photoPlaceholder.x));

        const y =
          photoElement.getAttribute('y') ??
          (radius > 0
            ? String(numeric(photoElement.getAttribute('cy'), 0) - radius)
            : String(template.photoPlaceholder.y));

        const width =
          photoElement.getAttribute('width') ??
          (radius > 0 ? String(radius * 2) : String(template.photoPlaceholder.width));

        const height =
          photoElement.getAttribute('height') ??
          (radius > 0 ? String(radius * 2) : String(template.photoPlaceholder.height));

        imageElement.setAttribute('x', x);
        imageElement.setAttribute('y', y);
        imageElement.setAttribute('width', width);
        imageElement.setAttribute('height', height);

        // Carry over anything that affects how/where it renders (id so future
        // lookups keep working, plus clip/mask/transform so the photo stays
        // cropped and positioned like the original placeholder shape).
        for (const attribute of ['id', 'clip-path', 'transform', 'mask']) {
          const value = photoElement.getAttribute(attribute);
          if (value) imageElement.setAttribute(attribute, value);
        }

        photoElement.parentNode?.replaceChild(imageElement, photoElement);
      }

      imageElement.setAttribute('href', photoData);
      imageElement.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      imageElement.setAttribute('data-generated-photo', 'true');
      imageElement.removeAttribute('xlink:href');

      svg = new XMLSerializer().serializeToString(doc);
    }
  }

  return svg;
}

function svgDimensions(svgText: string) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  const viewBox = root.getAttribute('viewBox')?.split(/\s+/).map(Number);
  return {
    width: viewBox?.[2] || numeric(root.getAttribute('width'), 640),
    height: viewBox?.[3] || numeric(root.getAttribute('height'), 900),
  };
}

export async function renderSvgToPng(svgText: string, scale = 2): Promise<Blob> {
  const { width, height } = svgDimensions(svgText);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas rendering is not supported in this browser');
  context.fillStyle = '#fffdf8';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const image = new Image();
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The SVG preview could not be rendered'));
    image.src = svgUrl;
  });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG export failed')), 'image/png', .96));
}

export async function resolvePhotoData(value: string, archive?: PhotoArchive): Promise<string | undefined> {
  const result = findPhoto(value, archive);
  if (!result) return undefined;
  if (typeof result === 'string') {
    if (result.startsWith('data:')) return result;
    try {
      const response = await fetch(result, { mode: 'cors' });
      if (!response.ok) return undefined;
      return await fileToDataUrl(new File([await response.blob()], 'remote-photo'));
    } catch {
      return undefined;
    }
  }
  return await fileToDataUrl(result);
}
