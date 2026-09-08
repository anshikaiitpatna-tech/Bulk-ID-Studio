import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleHelp,
  CloudUpload,
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Layers3,
  MoreHorizontal,
  Play,
  Printer,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  Zap,
} from "lucide-react";

type Step = "Upload" | "Map fields" | "Review" | "Export";
type MappingKey = "Name" | "Roll No" | "Department" | "Photo";

const rows = [
  { name: "Maya Sen", roll: "CS-2041", dept: "Computer Science", photo: true, status: "Ready" },
  { name: "Arjun Rao", roll: "ME-1178", dept: "Mechanical Engineering", photo: true, status: "Ready" },
  { name: "Lina Joseph", roll: "DS-0832", dept: "Data Science", photo: false, status: "Photo missing" },
  { name: "Kabir Iyer", roll: "EC-2204", dept: "Electronics", photo: true, status: "Ready" },
  { name: "Nisha Patel", roll: "", dept: "Architecture", photo: true, status: "Roll No missing" },
];

const initialMappings: Record<MappingKey, string> = {
  Name: "Full name",
  "Roll No": "Student ID",
  Department: "Department",
  Photo: "Photo filename",
};

const tokens = ["{{Name}}", "{{Roll No}}", "{{Department}}", "{{Photo}}"];

function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" | "red" }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function MiniCard({ item, selected, onClick }: { item: (typeof rows)[number]; selected: boolean; onClick: () => void }) {
  return (
    <button className={`mini-card ${selected ? "mini-card-selected" : ""}`} onClick={onClick}>
      <div className="card-art">
        <div className="card-ribbon" />
        <div className="card-mark">N</div>
        <div className="card-avatar">{item.photo ? item.name.split(" ").map((n) => n[0]).join("") : <ImageIcon size={14} />}</div>
        <div className="card-lines">
          <strong>{item.name}</strong>
          <span>{item.roll || "Missing roll no."}</span>
          <span>{item.dept}</span>
        </div>
        <div className="card-footer">NORTHSTAR ACADEMY · 2026</div>
      </div>
      <div className="mini-card-meta"><span>{item.name}</span><span className={item.status !== "Ready" ? "warn-text" : "ready-text"}>{item.status}</span></div>
    </button>
  );
}

export function BulkIdStudio() {
  const [step, setStep] = useState<Step>("Map fields");
  const [mappings, setMappings] = useState(initialMappings);
  const [selected, setSelected] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");

  const filteredRows = useMemo(() => rows.filter((row) => row.name.toLowerCase().includes(search.toLowerCase()) || row.dept.toLowerCase().includes(search.toLowerCase())), [search]);
  const activeRow = rows[selected];

  const feedback = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  };

  const generate = () => {
    setIsGenerating(true);
    feedback("Rendering a sample batch…");
    window.setTimeout(() => {
      setIsGenerating(false);
      setGenerated(true);
      setStep("Review");
      feedback("248 cards are ready for review.");
    }, 1200);
  };

  return (
    <main className="studio-shell">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap');
        :root { --ink:#172526; --muted:#71807d; --line:#dce6df; --paper:#f7f8f4; --cream:#fffdf8; --sage:#dce9df; --mint:#e9f2e8; --teal:#1e5651; --orange:#d88158; --gold:#e8b86d; }
        * { box-sizing:border-box; } button, select, input { font:inherit; } button { cursor:pointer; }
        .studio-shell { min-height:100vh; background:var(--paper); color:var(--ink); font-family:Manrope, sans-serif; padding:28px 34px 40px; }
        .studio-top { max-width:1440px; margin:auto; display:flex; align-items:flex-start; justify-content:space-between; gap:30px; padding-bottom:24px; }
        .eyebrow { font:500 10px 'DM Mono',monospace; text-transform:uppercase; letter-spacing:.16em; color:#7c9187; margin-bottom:10px; }
        h1 { font-size:27px; letter-spacing:-.04em; line-height:1.1; margin:0; font-weight:800; } h2 { font-size:15px; margin:0; letter-spacing:-.02em; } h3 { font-size:12px; margin:0; }
        .subhead { color:var(--muted); font-size:12px; margin-top:8px; } .top-actions { display:flex; gap:8px; align-items:center; }
        .btn { border:1px solid var(--line); border-radius:8px; background:var(--cream); color:var(--ink); padding:9px 13px; display:inline-flex; align-items:center; gap:8px; font-size:11px; font-weight:700; transition:transform .18s, background .18s; }
        .btn:hover { transform:translateY(-1px); background:#fff; } .btn-primary { background:var(--teal); color:#f6fbf5; border-color:var(--teal); box-shadow:0 4px 0 #123c38; } .btn-primary:hover { background:#276963; }
        .icon-btn { width:34px; height:34px; padding:0; justify-content:center; } .progress-wrap { max-width:1440px; margin:auto; background:var(--cream); border:1px solid var(--line); border-radius:12px; padding:14px 18px; }
        .steps { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; } .step { display:flex; gap:10px; align-items:center; color:#a3afaa; font-size:11px; font-weight:700; }
        .step button { display:flex; align-items:center; gap:10px; border:0; background:none; color:inherit; padding:0; } .step.active { color:var(--teal); } .step.done { color:#56806c; }
        .step-dot { width:25px; height:25px; border:1px solid #c9d6cf; border-radius:50%; display:grid; place-items:center; font:500 10px 'DM Mono'; background:#fbfcf8; } .step.active .step-dot { background:var(--teal); color:#fff; border-color:var(--teal); } .step.done .step-dot { background:#dbece0; color:#3d755b; border-color:#c6dfcd; }
        .step-line { height:1px; background:#e2e8e1; flex:1; margin-left:2px; }
        .workspace { max-width:1440px; margin:18px auto 0; display:grid; grid-template-columns:310px minmax(440px,1fr) 330px; gap:14px; align-items:start; }
        .panel { background:var(--cream); border:1px solid var(--line); border-radius:12px; overflow:hidden; } .panel-head { padding:17px 18px 14px; border-bottom:1px solid #e7eee8; display:flex; justify-content:space-between; align-items:center; }
        .label { color:#84948c; font:500 10px 'DM Mono'; text-transform:uppercase; letter-spacing:.12em; } .panel-body { padding:16px 18px; }
        .upload-box { border:1px dashed #b8cbbd; background:#f2f7ef; border-radius:9px; padding:18px; text-align:center; } .upload-icon { margin:auto; width:35px; height:35px; display:grid; place-items:center; color:var(--teal); background:#dbead9; border-radius:9px; }
        .upload-box p { font-size:11px; margin:10px 0 3px; font-weight:700; } .upload-box small { font-size:10px; color:var(--muted); }
        .file-row { display:flex; align-items:center; gap:9px; padding:12px 0; border-bottom:1px solid #edf1eb; } .file-icon { color:#ba7054; } .file-row strong { font-size:11px; display:block; } .file-row span { font:10px 'DM Mono'; color:var(--muted); }
        .file-check { margin-left:auto; color:#4f8b68; } .token-list { display:flex; flex-wrap:wrap; gap:6px; margin-top:11px; } .token { font:10px 'DM Mono'; color:#3f685f; border:1px solid #cadfd0; padding:5px 7px; border-radius:5px; background:#f0f7ef; }
        .mapping-row { display:grid; grid-template-columns:1fr 16px 1.1fr; gap:7px; align-items:center; padding:10px 0; border-bottom:1px solid #edf1eb; } .mapping-row:last-child { border:0; } .mapping-row code { font:10px 'DM Mono'; color:#497267; } .mapping-row select { min-width:0; width:100%; border:1px solid var(--line); background:#fbfcf8; padding:7px 8px; border-radius:6px; color:#465b56; font-size:10px; outline:none; }
        .mapping-row select:focus { border-color:#7ea995; } .map-arrow { color:#adc0b5; } .helper { margin-top:14px; background:#fff8e9; border:1px solid #f0dfb5; border-radius:8px; padding:10px; color:#826b45; font-size:10px; line-height:1.45; display:flex; gap:7px; }
        .preview-panel { min-height:552px; } .preview-toolbar { display:flex; gap:8px; align-items:center; } .searchbox { display:flex; align-items:center; gap:6px; border:1px solid var(--line); background:#fcfdf9; border-radius:6px; padding:7px 9px; color:#9aa9a1; } .searchbox input { border:0; outline:0; width:120px; background:transparent; font-size:10px; color:var(--ink); }
        .preview-stage { margin:18px; border:1px solid #d8e3d8; background:#edf3eb; border-radius:10px; min-height:315px; display:grid; place-items:center; position:relative; overflow:hidden; } .preview-stage:before { content:""; position:absolute; inset:0; opacity:.35; background-image:linear-gradient(#d8e5d9 1px,transparent 1px),linear-gradient(90deg,#d8e5d9 1px,transparent 1px); background-size:24px 24px; }
        .preview-note { position:absolute; left:14px; top:12px; font:10px 'DM Mono'; color:#789087; z-index:1; } .id-card { width:205px; height:276px; background:#fffdf7; border:1px solid #d8d9cf; box-shadow:0 16px 32px rgba(41,73,57,.15); position:relative; z-index:1; padding:16px; overflow:hidden; }
        .id-card .big-mark { font-size:40px; font-weight:800; line-height:.8; color:#dce9df; position:absolute; right:8px; top:12px; } .id-card .school { font:700 8px 'DM Mono'; letter-spacing:.09em; color:var(--teal); position:relative; } .id-card .school-line { width:33px; height:2px; background:var(--orange); margin:8px 0 12px; }
        .id-photo { width:84px; height:98px; background:#dce9df; margin:auto; display:grid; place-items:center; color:#6d9580; font-size:22px; font-weight:700; border-radius:2px; } .id-card .id-name { font-size:15px; font-weight:800; letter-spacing:-.04em; margin-top:12px; } .id-card .id-dept { color:#729083; font-size:9px; margin-top:2px; } .id-card .id-meta { border-top:1px solid #e4e9e1; margin-top:12px; padding-top:9px; display:flex; justify-content:space-between; font:8px 'DM Mono'; color:#60736b; } .id-card .id-bar { height:17px; margin-top:11px; background:repeating-linear-gradient(90deg,#315952 0 2px,transparent 2px 4px); opacity:.65; }
        .preview-foot { display:flex; justify-content:space-between; align-items:center; padding:0 18px 17px; color:#73847b; font-size:10px; } .preview-foot strong { color:var(--ink); } .zoom { display:flex; gap:3px; align-items:center; font:10px 'DM Mono'; }
        .mini-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:9px; padding:14px 18px 18px; } .mini-card { border:0; padding:0; text-align:left; background:transparent; color:var(--ink); } .mini-card:hover .card-art { transform:translateY(-2px); } .mini-card-selected .card-art { outline:2px solid var(--orange); outline-offset:2px; } .card-art { height:126px; background:#fdfcf6; border:1px solid #dce3da; border-radius:6px; padding:10px; position:relative; transition:transform .18s; overflow:hidden; } .card-ribbon { position:absolute; left:0; top:0; bottom:0; width:7px; background:#d8e8d9; } .card-mark { position:absolute; right:9px; top:8px; color:#d4e2d6; font-size:21px; font-weight:800; } .card-avatar { width:32px; height:39px; border-radius:2px; background:#dbe9dd; margin-top:14px; display:grid; place-items:center; color:#659078; font-size:10px; font-weight:700; } .card-lines { position:absolute; top:58px; left:53px; right:6px; display:grid; gap:3px; } .card-lines strong { font-size:7px; } .card-lines span { font:6px 'DM Mono'; color:#789086; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .card-footer { position:absolute; bottom:7px; left:10px; font:5px 'DM Mono'; color:#81928a; } .mini-card-meta { display:flex; justify-content:space-between; gap:3px; margin-top:6px; font-size:9px; color:#60736a; } .ready-text { color:#56836a; } .warn-text { color:#b67650; }
        .status-stack { display:grid; gap:9px; } .status-row { display:flex; align-items:center; gap:9px; padding:10px; background:#f5f8f3; border-radius:7px; font-size:10px; } .status-row svg { color:#608f70; } .status-row strong { display:block; font-size:11px; } .status-row span { color:var(--muted); font-size:9px; } .status-row .count { margin-left:auto; font:500 11px 'DM Mono'; color:var(--teal); }
        .issue-box { margin-top:14px; border:1px solid #efd9b1; background:#fff9eb; border-radius:8px; padding:12px; } .issue-top { display:flex; align-items:center; justify-content:space-between; color:#956c39; margin-bottom:9px; } .issue-box ul { margin:0; padding:0; list-style:none; display:grid; gap:8px; } .issue-box li { font-size:10px; display:flex; gap:7px; color:#7d694b; } .issue-box li svg { flex:none; margin-top:1px; } .divider { height:1px; background:#e7eee8; margin:16px 0; }
        .export-card { background:#eef5ec; border:1px solid #d4e5d5; border-radius:8px; padding:13px; } .export-card p { font-size:10px; color:#667d70; line-height:1.5; margin:7px 0 12px; } .export-actions { display:grid; gap:7px; } .export-actions .btn { justify-content:center; } .export-actions .btn-primary { box-shadow:none; } .toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#203f3b; color:#f4fbf2; padding:10px 15px; border-radius:7px; font-size:11px; z-index:10; box-shadow:0 8px 24px #25433d44; animation:rise .25s ease-out; } @keyframes rise { from { opacity:0; transform:translate(-50%,8px); } to { opacity:1; transform:translate(-50%,0); } }
        @media (max-width:1050px) { .studio-shell { padding:22px 18px; } .workspace { grid-template-columns:270px minmax(400px,1fr); } .right-panel { grid-column:1 / -1; display:grid; grid-template-columns:1fr 1fr; gap:14px; } .right-panel .panel { min-height:0; } }
        @media (max-width:700px) { .studio-shell { padding:17px 12px 28px; } .studio-top { display:block; } .top-actions { margin-top:16px; } .steps { overflow:auto; grid-template-columns:repeat(4,minmax(110px,1fr)); } .step-line { display:none; } .workspace { grid-template-columns:1fr; } .right-panel { display:block; } .preview-panel { min-height:0; } .mini-grid { grid-template-columns:repeat(3,1fr); } .mini-card:nth-child(n+4) { display:none; } .panel-head { padding:14px; } .panel-body { padding:14px; } .preview-toolbar .searchbox { display:none; } }
      `}</style>
      <header className="studio-top">
        <div><div className="eyebrow">Northstar Studio / Batch 04</div><h1>Bulk ID Studio</h1><div className="subhead">Turn one template and a spreadsheet into press-ready identity cards.</div></div>
        <div className="top-actions"><button className="btn" onClick={() => feedback("Autosave is on for this batch.")}><CloudUpload size={14} /> Autosaved 2m ago</button><button className="btn icon-btn" onClick={() => feedback("Studio settings opened.")}><Settings2 size={15} /></button><button className="btn icon-btn" onClick={() => feedback("Help center opened.")}><CircleHelp size={15} /></button></div>
      </header>
      <nav className="progress-wrap" aria-label="Generation steps"><div className="steps">{(["Upload", "Map fields", "Review", "Export"] as Step[]).map((item, i) => <div key={item} className={`step ${step === item ? "active" : ""} ${i < ["Upload", "Map fields", "Review", "Export"].indexOf(step) ? "done" : ""}`}><button onClick={() => setStep(item)}><span className="step-dot">{i < ["Upload", "Map fields", "Review", "Export"].indexOf(step) ? <Check size={12} /> : i + 1}</span>{item}</button>{i < 3 && <span className="step-line" />}</div>)}</div></nav>
      <section className="workspace">
        <aside className="panel">
          <div className="panel-head"><div><div className="label">Source files</div><h2>Batch ingredients</h2></div><button className="btn icon-btn" onClick={() => feedback("File picker ready.")}><MoreHorizontal size={15} /></button></div>
          <div className="panel-body">
            <div className="upload-box"><div className="upload-icon"><Upload size={17} /></div><p>Drop a new file here</p><small>SVG, CSV or XLSX · up to 25 MB</small></div>
            <div className="file-row"><FileText size={19} className="file-icon" /><div><strong>Campus ID 2026.svg</strong><span>SVG template · 184 KB</span></div><Check size={15} className="file-check" /></div>
            <div className="file-row"><FileSpreadsheet size={19} className="file-icon" /><div><strong>students_spring.csv</strong><span>248 rows · 46 KB</span></div><Check size={15} className="file-check" /></div>
            <div className="label" style={{ marginTop: 18 }}>Detected tokens <span style={{ color: "#58816d" }}>· 4 found</span></div><div className="token-list">{tokens.map((token) => <span className="token" key={token}>{token}</span>)}</div>
            <div className="helper"><Sparkles size={14} /> Tokens are editable in the template. We found a matching spreadsheet column for each one.</div>
          </div>
        </aside>
        <section className="panel preview-panel">
          <div className="panel-head"><div><div className="label">Step 02 / live preview</div><h2>Map fields & preview cards</h2></div><div className="preview-toolbar"><div className="searchbox"><Search size={13} /><input placeholder="Find a row…" value={search} onChange={(e) => setSearch(e.target.value)} /></div><button className="btn icon-btn" onClick={() => feedback("Preview refreshed.")}><RefreshCw size={14} /></button></div></div>
          <div className="preview-stage"><span className="preview-note">CANVAS / 100%</span><div className="id-card"><div className="big-mark">N</div><div className="school">NORTHSTAR ACADEMY</div><div className="school-line" /><div className="id-photo">{activeRow.photo ? activeRow.name.split(" ").map((n) => n[0]).join("") : <ImageIcon size={23} />}</div><div className="id-name">{activeRow.name}</div><div className="id-dept">{activeRow.dept}</div><div className="id-meta"><span>{activeRow.roll || "—"}</span><span>2026</span></div><div className="id-bar" /></div></div>
          <div className="preview-foot"><span>Showing <strong>{activeRow.name}</strong> · row {selected + 1} of 248</span><span className="zoom">− &nbsp; 100% &nbsp; +</span></div>
          <div className="divider" style={{ margin: "0 18px" }} />
          <div style={{ padding: "16px 18px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}><div><div className="label">Generated preview</div><h2 style={{ marginTop: 3 }}>{generated ? "Batch rendered" : "Sample rows"}</h2></div><Pill tone={generated ? "green" : "neutral"}>{generated ? "248 / 248 ready" : "5 sample rows"}</Pill></div>
          <div className="mini-grid">{filteredRows.map((item) => <MiniCard key={item.name} item={item} selected={item.name === activeRow.name} onClick={() => setSelected(rows.findIndex((row) => row.name === item.name))} />)}</div>
        </section>
        <aside className="right-panel">
          <div className="panel">
            <div className="panel-head"><div><div className="label">Quality check</div><h2>Before you generate</h2></div><ShieldCheck size={17} color="#5b8b70" /></div>
            <div className="panel-body"><div className="status-stack"><div className="status-row"><Check size={16} /><div><strong>Fields mapped</strong><span>All 4 tokens have a source</span></div><span className="count">4/4</span></div><div className="status-row"><ImageIcon size={16} /><div><strong>Photos matched</strong><span>2 rows need attention</span></div><span className="count">246</span></div><div className="status-row"><Layers3 size={16} /><div><strong>Rows imported</strong><span>Spreadsheet is ready</span></div><span className="count">248</span></div></div>
              <div className="issue-box"><div className="issue-top"><strong style={{ fontSize: 11 }}>2 items to resolve</strong><AlertTriangle size={14} /></div><ul><li><AlertTriangle size={12} /> Lina Joseph — photo filename not found</li><li><AlertTriangle size={12} /> Nisha Patel — Roll No is empty</li></ul></div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><div><div className="label">Field mapping</div><h2>Spreadsheet → template</h2></div><Pill tone="green">Synced</Pill></div>
            <div className="panel-body">{(Object.keys(mappings) as MappingKey[]).map((key) => <div className="mapping-row" key={key}><code>{`{{${key}}}`}</code><ArrowRight size={13} className="map-arrow" /><select value={mappings[key]} onChange={(e) => { setMappings({ ...mappings, [key]: e.target.value }); feedback(`${key} mapped to ${e.target.value}.`); }}><option>Full name</option><option>Student ID</option><option>Department</option><option>Photo filename</option><option>Ignore column</option></select></div>)}</div>
          </div>
          <div className="panel export-card">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Zap size={15} color="#b8784f" /><h2>Ready when you are</h2></div><p>{generated ? "Your batch passed the preview check. Choose a delivery format." : "Generate a full preview to validate every row before export."}</p><div className="export-actions"><button className="btn btn-primary" onClick={generated ? () => feedback("ZIP export prepared — 248 cards.") : generate}>{isGenerating ? <><RefreshCw size={14} className="spin" /> Rendering 248 cards…</> : generated ? <><Download size={14} /> Download ZIP · 248 cards</> : <><Play size={14} /> Generate preview</>}</button>{generated && <button className="btn" onClick={() => feedback("Print PDF queued with crop marks.")}><Printer size={14} /> Export print PDF</button>}</div>
          </div>
        </aside>
      </section>
      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}
