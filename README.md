Live: bulk-id-studio.vercel.app

Turn one SVG design template and a spreadsheet into hundreds of press-ready ID cards — no manual copy-pasting in Canva or Illustrator.
Built for the IIT Patna Alumni & International Relations Cell to automate Alumni ID card generation for 250+ recipients.
What it does

Upload a design template (SVG) that contains placeholder tokens such as {{Name}}, {{Roll No}}, {{Department}}, and a photo box.
Upload a spreadsheet (CSV or XLSX) with one row per person.
Map each spreadsheet column to a template token. The app auto-suggests matches and highlights anything that is missing.
Preview the cards live with real data rendered into the actual design before generating anything.
Generate in bulk. Every row is turned into a finished card and packaged as a downloadable ZIP of PNGs plus a print-ready combined PDF.

Key features

Dynamic token detection — No hardcoded fields. Any {{Token}} present in the uploaded SVG is automatically detected and added to the mapping interface.
Photo matching — Map a spreadsheet column to a photo filename or URL. Unmatched photos are clearly flagged instead of failing silently.
Design-tool agnostic — Works with SVGs exported from Figma, Illustrator, or Canva. Common export quirks are handled automatically:
Canva’s split-<tspan> text export (where tokens are broken across multiple text runs) is merged back into a single readable token.
Placeholder shapes exported as <rect>, <circle>, or <ellipse> (the default in Figma, Illustrator, and Canva) are converted into real <image> elements at render time, because photo swapping only works on <image> tags in SVG.

Live quality checks — Mapped fields, matched photos, and imported rows are calculated live from the uploaded data. Issues are listed specifically (for example, “Lina Joseph — photo filename not found”) rather than shown as a generic error count.
Bulk export — All cards are delivered as a ZIP of individual PNGs, together with a combined print-ready PDF (CR80 card size, multiple cards per page).

Tech stack

React + TypeScript, Tailwind CSS
papaparse / xlsx (SheetJS) for spreadsheet parsing
jszip for archive handling and ZIP export
Native SVG DOM manipulation for token substitution and photo embedding
Canvas-based SVG → PNG rasterization

Known limitations

If the SVG text has been converted to outlines or paths at export time (for example, Illustrator’s “Create Outlines” or any similar flatten option), the token text no longer exists as editable data and cannot be detected. The source design must be re-exported with editable text.
Photo cropping follows the placeholder’s bounding box (preserveAspectRatio="xMidYMid slice"). Non-rectangular crops depend on the original shape’s clip-path being preserved during export.
