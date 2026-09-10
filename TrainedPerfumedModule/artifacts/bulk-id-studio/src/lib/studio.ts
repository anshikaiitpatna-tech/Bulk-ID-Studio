import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

export type SpreadsheetRow = Record<string, string>;

export type PhotoArchive = {
  files: Record<string, File>;
  names: string[];
};

export type PhotoPlaceholder = {
  elementIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  source: string;
};

export type SvgElementOption = {
  index: number;
  tag: string;
  id?: string;
  label: string;
  text: string;
  hasImageToken: boolean;
};

export type ParsedTemplate = {
  rawSvg: string;
  tokens: string[];
  photoPlaceholder?: PhotoPlaceholder;
  elements: SvgElementOption[];
};

export type SpreadsheetData = {
  headers: string[];
  rows: SpreadsheetRow[];
  embeddedPhotos?: Record<number, File>;
};

export type FieldMapping = Record<string, string>;

export type GenerationIssue = {
  row: number;
  field: string;
  message: string;
  person?: string;
};

export type GeneratedCard = {
  rowIndex: number;
  pngBlob: Blob;
  svgText: string;
};


/* =========================================================
   BASIC HELPERS
========================================================= */

const cleanToken = (value: string) =>
  value
    .trim()
    .replace(/^\{\{|\}\}$/g, '')
    .trim();

const baseName = (name: string) =>
  name
    .split('/')
    .pop()
    ?.replace(/\.[^.]+$/, '')
    .toLowerCase() ?? '';

const fileNameKey = (name: string) =>
  name.split('/').pop()?.toLowerCase() ?? '';

const escapeXml = (value: string) =>
  value.replace(
    /[<>&'"]/g,
    (character) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        "'": '&apos;',
        '"': '&quot;',
      })[character] ?? character,
  );

function numeric(value: string | null, fallback: number) {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}


/* =========================================================
   CANVA SVG SANITIZATION
========================================================= */

function sanitizeCanvaSvg(rawSvg: string): string {
  let cleaned = rawSvg;

  /*
   * Canva can split:
   *
   * {{image}}
   *
   * into multiple tspans.
   *
   * Example:
   *
   * <tspan>{{</tspan>
   * <tspan>image</tspan>
   * <tspan>}}</tspan>
   *
   * This merges those tspans when they belong to a token.
   */

  cleaned = cleaned.replace(
    /(<text[^>]*>)[\s\S]*?(<\/text>)/gi,
    (fullMatch) => {
      const textContentOnly = fullMatch.replace(/<[^>]+>/g, '');

      if (/\{\{[\s\S]*?\}\}/.test(textContentOnly)) {
        return fullMatch.replace(
          /<\/tspan>\s*<tspan[^>]*>/gi,
          '',
        );
      }

      return fullMatch;
    },
  );

  return cleaned;
}


/* =========================================================
   SVG ELEMENT LIST
========================================================= */

/**
 * Returns all SVG elements that the user can potentially select
 * as the image placeholder.
 *
 * IMPORTANT:
 * We do NOT automatically assume that <image> means photo.
 */
export function getSvgElements(rawSvg: string): SvgElementOption[] {
  const sanitizedSvg = sanitizeCanvaSvg(rawSvg);

  const doc = new DOMParser().parseFromString(
    sanitizedSvg,
    'image/svg+xml',
  );

  const elements = Array.from(doc.querySelectorAll('*'));

  return elements.map((element, index) => {
    const tag = element.tagName.toLowerCase();

    const id = element.getAttribute('id') ?? '';

    const text = element.textContent?.trim() ?? '';

    const hasImageToken =
      /\{\{\s*(image|photo)\s*\}\}/i.test(text);

    let label = '';

    if (id) {
      label = `#${id}`;
    } else if (text) {
      label = text.slice(0, 60);
    } else {
      label = `<${tag}>`;
    }

    return {
      index,
      tag,
      id: id || undefined,
      label,
      text,
      hasImageToken,
    };
  });
}


/* =========================================================
   FIND ELEMENT GEOMETRY
========================================================= */

function getElementGeometry(
  element: Element,
  svgWidth: number,
  svgHeight: number,
) {
  const tag = element.tagName.toLowerCase();

  const fallbackWidth = svgWidth * 0.28;
  const fallbackHeight = fallbackWidth / 0.72;

  /*
   * IMAGE / RECT
   */
  if (tag === 'image' || tag === 'rect') {
    const width = numeric(
      element.getAttribute('width'),
      fallbackWidth,
    );

    const height = numeric(
      element.getAttribute('height'),
      fallbackHeight,
    );

    const x = numeric(
      element.getAttribute('x'),
      (svgWidth - width) / 2,
    );

    const y = numeric(
      element.getAttribute('y'),
      (svgHeight - height) / 2,
    );

    return {
      x,
      y,
      width,
      height,
    };
  }

  /*
   * CIRCLE
   */
  if (tag === 'circle') {
    const radius = numeric(
      element.getAttribute('r'),
      Math.min(svgWidth, svgHeight) * 0.1,
    );

    const cx = numeric(
      element.getAttribute('cx'),
      svgWidth / 2,
    );

    const cy = numeric(
      element.getAttribute('cy'),
      svgHeight / 2,
    );

    return {
      x: cx - radius,
      y: cy - radius,
      width: radius * 2,
      height: radius * 2,
    };
  }

  /*
   * ELLIPSE
   */
  if (tag === 'ellipse') {
    const rx = numeric(
      element.getAttribute('rx'),
      svgWidth * 0.1,
    );

    const ry = numeric(
      element.getAttribute('ry'),
      svgHeight * 0.1,
    );

    const cx = numeric(
      element.getAttribute('cx'),
      svgWidth / 2,
    );

    const cy = numeric(
      element.getAttribute('cy'),
      svgHeight / 2,
    );

    return {
      x: cx - rx,
      y: cy - ry,
      width: rx * 2,
      height: ry * 2,
    };
  }

  /*
   * FALLBACK
   */
  return {
    x: (svgWidth - fallbackWidth) / 2,
    y: (svgHeight - fallbackHeight) / 2,
    width: fallbackWidth,
    height: fallbackHeight,
  };
}


/* =========================================================
   PARSE SVG TEMPLATE
========================================================= */

export function parseSvgTemplate(
  rawSvg: string,
): ParsedTemplate {
  const sanitizedSvg = sanitizeCanvaSvg(rawSvg);

  const found = new Set<string>();

  /*
   * Find {{name}}, {{roll}}, {{department}}, {{image}}, etc.
   */
  for (const match of sanitizedSvg.matchAll(
    /\{\{\s*([^}]+?)\s*\}\}/g,
  )) {
    found.add(cleanToken(match[1]));
  }

  const doc = new DOMParser().parseFromString(
    sanitizedSvg,
    'image/svg+xml',
  );

  const root = doc.documentElement;

  const viewBox = root
    .getAttribute('viewBox')
    ?.split(/\s+/)
    .map(Number);

  const viewWidth =
    viewBox?.[2] ??
    numeric(root.getAttribute('width'), 640);

  const viewHeight =
    viewBox?.[3] ??
    numeric(root.getAttribute('height'), 900);

  const elements = Array.from(
    doc.querySelectorAll('*'),
  );

  const elementOptions: SvgElementOption[] =
    elements.map((element, index) => {
      const tag =
        element.tagName.toLowerCase();

      const id =
        element.getAttribute('id') ?? '';

      const text =
        element.textContent?.trim() ?? '';

      const hasImageToken =
        /\{\{\s*(image|photo)\s*\}\}/i.test(text);

      let label = '';

      if (id) {
        label = `#${id}`;
      } else if (text) {
        label = text.slice(0, 60);
      } else {
        label = `<${tag}>`;
      }

      return {
        index,
        tag,
        id: id || undefined,
        label,
        text,
        hasImageToken,
      };
    });

  /*
   * IMPORTANT:
   *
   * ONLY {{image}} or {{photo}} identifies an automatic
   * placeholder.
   *
   * We DO NOT check whether the element is <image>.
   */

  let photoIndex = -1;

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];

    const text =
      element.textContent?.trim() ?? '';

    if (
      /\{\{\s*(image|photo)\s*\}\}/i.test(text)
    ) {
      photoIndex = i;
      break;
    }
  }

  let photoPlaceholder: PhotoPlaceholder | undefined;

  if (photoIndex >= 0) {
    const element = elements[photoIndex];

    const geometry = getElementGeometry(
      element,
      viewWidth,
      viewHeight,
    );

    photoPlaceholder = {
      elementIndex: photoIndex,
      ...geometry,
      source: element.tagName.toLowerCase(),
    };

    found.add('image');
  }

  return {
    rawSvg: sanitizedSvg,
    tokens: Array.from(found),
    photoPlaceholder,
    elements: elementOptions,
  };
}


/* =========================================================
   MANUALLY CREATE PHOTO PLACEHOLDER
========================================================= */

/**
 * Call this when the user manually selects an SVG element
 * from the UI.
 *
 * Example:
 *
 * const template = setPhotoPlaceholder(template, 12);
 */

export function setPhotoPlaceholder(
  template: ParsedTemplate,
  elementIndex: number,
): ParsedTemplate {
  const doc = new DOMParser().parseFromString(
    template.rawSvg,
    'image/svg+xml',
  );

  const elements = Array.from(
    doc.querySelectorAll('*'),
  );

  const element = elements[elementIndex];

  if (!element) {
    return {
      ...template,
      photoPlaceholder: undefined,
    };
  }

  const root = doc.documentElement;

  const viewBox = root
    .getAttribute('viewBox')
    ?.split(/\s+/)
    .map(Number);

  const viewWidth =
    viewBox?.[2] ??
    numeric(root.getAttribute('width'), 640);

  const viewHeight =
    viewBox?.[3] ??
    numeric(root.getAttribute('height'), 900);

  const geometry = getElementGeometry(
    element,
    viewWidth,
    viewHeight,
  );

  return {
    ...template,

    photoPlaceholder: {
      elementIndex,
      ...geometry,
      source: element.tagName.toLowerCase(),
    },
  };
}


/* =========================================================
   SPREADSHEET PARSER
========================================================= */

export async function parseSpreadsheet(
  file: File,
): Promise<SpreadsheetData> {

  /*
   * CSV
   */
  if (
    file.name
      .toLowerCase()
      .endsWith('.csv')
  ) {
    const text = await file.text();

    const parsed =
      Papa.parse<SpreadsheetRow>(
        text,
        {
          header: true,
          skipEmptyLines: true,

          transformHeader: (header) =>
            header.trim(),
        },
      );

    const rows =
      parsed.data.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(
            ([key, value]) => [
              key,
              String(value ?? '').trim(),
            ],
          ),
        ),
      );

    const headers =
      parsed.meta.fields?.filter(Boolean) ??
      Object.keys(rows[0] ?? {});

    return {
      headers,
      rows,
    };
  }

  /*
   * XLSX
   */
  const buffer =
    await file.arrayBuffer();

  const workbook =
    XLSX.read(buffer, {
      type: 'array',
    });

  const firstSheet =
    workbook.Sheets[
      workbook.SheetNames[0]
    ];

  const rows =
    XLSX.utils
      .sheet_to_json<SpreadsheetRow>(
        firstSheet,
        {
          defval: '',
          raw: false,
        },
      )
      .map((row) =>
        Object.fromEntries(
          Object.entries(row).map(
            ([key, value]) => [
              key.trim(),
              String(value ?? '').trim(),
            ],
          ),
        ),
      );

  const embeddedPhotos:
    Record<number, File> = {};

  /*
   * Attempt to read Excel embedded photos.
   */
  try {
    const zip =
      await JSZip.loadAsync(buffer);

    const richXml =
      await zip
        .file(
          'xl/richData/rdrichvalue.xml',
        )
        ?.async('text');

    const sheetXml =
      await zip
        .file(
          'xl/worksheets/sheet1.xml',
        )
        ?.async('text');

    if (richXml && sheetXml) {
      const richDoc =
        new DOMParser().parseFromString(
          richXml,
          'application/xml',
        );

      const richValues =
        Array.from(
          richDoc.getElementsByTagNameNS(
            '*',
            'rv',
          ),
        );

      const sheetDoc =
        new DOMParser().parseFromString(
          sheetXml,
          'application/xml',
        );

      const cells =
        Array.from(
          sheetDoc.getElementsByTagNameNS(
            '*',
            'c',
          ),
        );

      const mediaFiles =
        new Set(
          Object.keys(zip.files).filter(
            (name) =>
              /^xl\/media\/image\d+\.(png|jpe?g|webp|gif)$/i.test(
                name,
              ),
          ),
        );

      for (const cell of cells) {
        const vm =
          cell.getAttribute('vm');

        const ref =
          cell.getAttribute('r');

        if (
          !vm ||
          !ref ||
          !/^[A-Z]+\d+$/.test(ref)
        ) {
          continue;
        }

        const richIndex =
          Number(vm) - 1;

        if (
          !Number.isInteger(richIndex) ||
          richIndex < 0 ||
          richIndex >= richValues.length
        ) {
          continue;
        }

        const rich =
          richValues[richIndex];

        const values =
          Array.from(
            rich.getElementsByTagNameNS(
              '*',
              'v',
            ),
          ).map(
            (node) =>
              node.textContent ?? '',
          );

        const localImageId =
          Number(values[0]);

        if (
          !Number.isInteger(
            localImageId,
          )
        ) {
          continue;
        }

        const mediaCandidates =
          Array.from(mediaFiles).filter(
            (name) =>
              Number(
                name.match(
                  /image(\d+)\./i,
                )?.[1],
              ) ===
              localImageId + 1,
          );

        const mediaName =
          mediaCandidates[0];

        if (!mediaName) {
          continue;
        }

        const blob =
          await zip
            .file(mediaName)!
            .async('blob');

        const extension =
          mediaName
            .split('.')
            .pop()
            ?.toLowerCase() ??
          'png';

        const mime =
          extension === 'jpg' ||
          extension === 'jpeg'
            ? 'image/jpeg'
            : extension === 'webp'
              ? 'image/webp'
              : extension === 'gif'
                ? 'image/gif'
                : 'image/png';

        const rowNumber =
          Number(
            ref.match(/\d+$/)?.[0],
          );

        const dataRowIndex =
          rowNumber - 2;

        if (
          dataRowIndex >= 0 &&
          dataRowIndex < rows.length
        ) {
          embeddedPhotos[
            dataRowIndex
          ] = new File(
            [blob],
            mediaName
              .split('/')
              .pop() ?? mediaName,
            {
              type: mime,
            },
          );
        }
      }
    }
  } catch {
    /*
     * Embedded image extraction failing
     * should NOT break spreadsheet parsing.
     */
  }

  return {
    headers: Object.keys(
      rows[0] ?? {},
    ),
    rows,
    embeddedPhotos,
  };
}


/* =========================================================
   PHOTO ARCHIVE
========================================================= */

export async function parsePhotoArchive(
  file: File,
): Promise<PhotoArchive> {

  const zip =
    await JSZip.loadAsync(file);

  const files:
    Record<string, File> = {};

  const names: string[] = [];

  await Promise.all(
    Object.values(zip.files)
      .filter(
        (entry) => !entry.dir,
      )
      .map(async (entry) => {

        const name =
          entry.name;

        if (
          !/\.(png|jpe?g|webp|gif)$/i.test(
            name,
          )
        ) {
          return;
        }

        const blob =
          await entry.async('blob');

        const extension =
          name
            .split('.')
            .pop()
            ?.toLowerCase();

        const inferredType =
          extension === 'jpg' ||
          extension === 'jpeg'
            ? 'image/jpeg'
            : extension === 'webp'
              ? 'image/webp'
              : extension === 'gif'
                ? 'image/gif'
                : 'image/png';

        const imageFile =
          new File(
            [blob],
            name.split('/').pop() ??
              name,
            {
              type:
                blob.type ||
                inferredType,
            },
          );

        files[
          fileNameKey(name)
        ] = imageFile;

        files[
          baseName(name)
        ] = imageFile;

        names.push(
          name.split('/').pop() ??
            name,
        );
      }),
  );

  return {
    files,
    names: names.sort(),
  };
}


/* =========================================================
   FIND PHOTO
========================================================= */

export function findPhoto(
  value: string,
  archive?: PhotoArchive,
): File | string | undefined {

  const trimmed =
    value.trim();

  if (!trimmed) {
    return undefined;
  }

  if (
    /^https?:\/\//i.test(trimmed) ||
    trimmed.startsWith('data:')
  ) {
    return trimmed;
  }

  if (!archive) {
    return undefined;
  }

  return (
    archive.files[
      fileNameKey(trimmed)
    ] ??
    archive.files[
      baseName(trimmed)
    ]
  );
}


/* =========================================================
   FILE → DATA URL
========================================================= */

export async function fileToDataUrl(
  file: File,
): Promise<string> {

  return await new Promise(
    (resolve, reject) => {

      const reader =
        new FileReader();

      reader.onload = () =>
        resolve(
          String(
            reader.result,
          ),
        );

      reader.onerror = () =>
        reject(
          reader.error ??
            new Error(
              'Could not read image',
            ),
        );

      reader.readAsDataURL(file);
    },
  );
}


/* =========================================================
   ROW LABEL
========================================================= */

export function rowLabel(
  row: SpreadsheetRow,
  mappings: FieldMapping,
  index: number,
) {

  const identityToken =
    Object.keys(mappings).find(
      (token) =>
        /name|person|student|roll|id|identifier/i.test(
          token,
        ) &&
        mappings[token] &&
        mappings[token] !==
          '__ignore__',
    );

  const preferred =
    identityToken
      ? mappings[identityToken]
      : undefined;

  return (
    (preferred &&
      row[preferred]) ||
    row.Name ||
    row.name ||
    row['Full name'] ||
    row.ID ||
    row.Id ||
    `Row ${index + 1}`
  );
}


/* =========================================================
   REPLACE PHOTO ELEMENT
========================================================= */

/**
 * Converts the selected SVG element into a real <image>
 * if necessary.
 *
 * The exact geometry of the selected element is preserved.
 */

function replaceElementWithImage(
  doc: Document,
  selectedElement: Element,
  photoData: string,
  placeholder: PhotoPlaceholder,
) {

  const tag =
    selectedElement.tagName.toLowerCase();

  let imageElement: Element;

  /*
   * If user selected an existing <image>,
   * simply use it.
   */
  if (tag === 'image') {
    imageElement =
      selectedElement;
  } else {

    /*
     * Otherwise convert the selected shape
     * into an actual SVG <image>.
     */

    imageElement =
      doc.createElementNS(
        'http://www.w3.org/2000/svg',
        'image',
      );

    /*
     * Preserve exact geometry.
     */

    const geometry =
      getElementGeometry(
        selectedElement,
        placeholder.x +
          placeholder.width,
        placeholder.y +
          placeholder.height,
      );

    imageElement.setAttribute(
      'x',
      String(
        selectedElement.getAttribute(
          'x',
        ) ??
          geometry.x ??
          placeholder.x,
      ),
    );

    imageElement.setAttribute(
      'y',
      String(
        selectedElement.getAttribute(
          'y',
        ) ??
          geometry.y ??
          placeholder.y,
      ),
    );

    imageElement.setAttribute(
      'width',
      String(
        selectedElement.getAttribute(
          'width',
        ) ??
          geometry.width ??
          placeholder.width,
      ),
    );

    imageElement.setAttribute(
      'height',
      String(
        selectedElement.getAttribute(
          'height',
        ) ??
          geometry.height ??
          placeholder.height,
      ),
    );

    /*
     * Preserve important attributes.
     */

    for (
      const attribute of [
        'id',
        'class',
        'clip-path',
        'mask',
        'transform',
        'opacity',
      ]
    ) {
      const value =
        selectedElement.getAttribute(
          attribute,
        );

      if (value) {
        imageElement.setAttribute(
          attribute,
          value,
        );
      }
    }

    /*
     * If it was a circle/ellipse and had no
     * clipping information, create a clip
     * so the image stays inside the shape.
     */

    if (
      (tag === 'circle' ||
        tag === 'ellipse') &&
      !selectedElement.getAttribute(
        'clip-path',
      )
    ) {

      const clipId =
        `photo-clip-${placeholder.elementIndex}`;

      const defs =
        doc.querySelector('defs') ??
        doc.documentElement.insertBefore(
          doc.createElementNS(
            'http://www.w3.org/2000/svg',
            'defs',
          ),
          doc.documentElement.firstChild,
        );

      const clipPath =
        doc.createElementNS(
          'http://www.w3.org/2000/svg',
          'clipPath',
        );

      clipPath.setAttribute(
        'id',
        clipId,
      );

      const shape =
        selectedElement.cloneNode(
          true,
        ) as Element;

      shape.removeAttribute('id');

      clipPath.appendChild(shape);

      defs.appendChild(
        clipPath,
      );

      imageElement.setAttribute(
        'clip-path',
        `url(#${clipId})`,
      );
    }

    /*
     * Replace ONLY this element.
     */

    selectedElement.parentNode?.replaceChild(
      imageElement,
      selectedElement,
    );
  }

  /*
   * Put the actual photo here.
   */

  imageElement.setAttribute(
    'href',
    photoData,
  );

  imageElement.setAttribute(
    'preserveAspectRatio',
    'xMidYMid slice',
  );

  imageElement.setAttribute(
    'data-generated-photo',
    'true',
  );

  /*
   * Remove old xlink reference if present.
   */

  imageElement.removeAttribute(
    'xlink:href',
  );

  return imageElement;
}


/* =========================================================
   RENDER SVG FOR ROW
========================================================= */

export function renderSvgForRow(
  template: ParsedTemplate,
  row: SpreadsheetRow,
  mappings: FieldMapping,
  photoData?: string,

  /*
   * Optional manual selection.
   *
   * If provided, this ALWAYS wins over {{image}}.
   */
  selectedPhotoElementIndex?: number,
) {

  /*
   * Replace normal {{tokens}}.
   *
   * {{image}} and {{photo}} are removed because
   * they are placeholders, not text.
   */

  let svg =
    template.rawSvg.replace(
      /\{\{\s*([^}]+?)\s*\}\}/g,
      (
        _match,
        rawToken: string,
      ) => {

        const token =
          cleanToken(rawToken);

        /*
         * PHOTO TOKENS
         */

        if (
          token.toLowerCase() ===
            'image' ||
          token.toLowerCase() ===
            'photo'
        ) {
          return '';
        }

        /*
         * NORMAL FIELD
         */

        const header =
          mappings[token];

        return header &&
          header !== '__ignore__'
          ? escapeXml(
              row[header] ?? '',
            )
          : '';
      },
    );

  /*
   * No photo supplied → just return SVG.
   */

  if (!photoData) {
    return svg;
  }

  /*
   * Parse generated SVG.
   */

  const doc =
    new DOMParser().parseFromString(
      svg,
      'image/svg+xml',
    );

  const elements =
    Array.from(
      doc.querySelectorAll('*'),
    );

  /*
   * -------------------------------------------------------
   * STEP 1
   *
   * If user manually selected an element,
   * use THAT element.
   * -------------------------------------------------------
   */

  let photoIndex =
    selectedPhotoElementIndex;

  /*
   * -------------------------------------------------------
   * STEP 2
   *
   * If no manual selection was made,
   * search ONLY for {{image}} / {{photo}}.
   * -------------------------------------------------------
   */

  if (
    photoIndex == null
  ) {

    photoIndex =
      elements.findIndex(
        (element) =>
          /\{\{\s*(image|photo)\s*\}\}/i.test(
            element.textContent ??
              '',
          ),
      );
  }

  /*
   * No placeholder found.
   *
   * IMPORTANT:
   * We DO NOT fall back to the first <image>.
   */

  if (
    photoIndex == null ||
    photoIndex < 0 ||
    photoIndex >= elements.length
  ) {
    return svg;
  }

  const photoElement =
    elements[photoIndex];

  /*
   * Get exact geometry before replacing.
   */

  const root =
    doc.documentElement;

  const viewBox =
    root
      .getAttribute('viewBox')
      ?.split(/\s+/)
      .map(Number);

  const viewWidth =
    viewBox?.[2] ??
    numeric(
      root.getAttribute(
        'width',
      ),
      640,
    );

  const viewHeight =
    viewBox?.[3] ??
    numeric(
      root.getAttribute(
        'height',
      ),
      900,
    );

  const geometry =
    getElementGeometry(
      photoElement,
      viewWidth,
      viewHeight,
    );

  const placeholder:
    PhotoPlaceholder = {
      elementIndex: photoIndex,
      ...geometry,
      source:
        photoElement.tagName.toLowerCase(),
    };

  /*
   * Replace ONLY selected element.
   */

  replaceElementWithImage(
    doc,
    photoElement,
    photoData,
    placeholder,
  );

  /*
   * Serialize back to SVG.
   */

  svg =
    new XMLSerializer()
      .serializeToString(doc);

  return svg;
}


/* =========================================================
   SVG DIMENSIONS
========================================================= */

function svgDimensions(
  svgText: string,
) {

  const doc =
    new DOMParser().parseFromString(
      svgText,
      'image/svg+xml',
    );

  const root =
    doc.documentElement;

  const viewBox =
    root
      .getAttribute('viewBox')
      ?.split(/\s+/)
      .map(Number);

  return {
    width:
      viewBox?.[2] ||
      numeric(
        root.getAttribute(
          'width',
        ),
        640,
      ),

    height:
      viewBox?.[3] ||
      numeric(
        root.getAttribute(
          'height',
        ),
        900,
      ),
  };
}


/* =========================================================
   SVG → PNG
========================================================= */

export async function renderSvgToPng(
  svgText: string,
  scale = 2,
): Promise<Blob> {

  const {
    width,
    height,
  } =
    svgDimensions(svgText);

  const canvas =
    document.createElement(
      'canvas',
    );

  canvas.width =
    Math.max(
      1,
      Math.round(
        width * scale,
      ),
    );

  canvas.height =
    Math.max(
      1,
      Math.round(
        height * scale,
      ),
    );

  const context =
    canvas.getContext('2d');

  if (!context) {
    throw new Error(
      'Canvas rendering is not supported in this browser',
    );
  }

  context.fillStyle =
    '#fffdf8';

  context.fillRect(
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const image =
    new Image();

  const svgUrl =
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      svgText,
    )}`;

  await new Promise<void>(
    (
      resolve,
      reject,
    ) => {

      image.onload =
        () => resolve();

      image.onerror =
        () =>
          reject(
            new Error(
              'The SVG preview could not be rendered',
            ),
          );

      image.src = svgUrl;
    },
  );

  context.drawImage(
    image,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return await new Promise<Blob>(
    (
      resolve,
      reject,
    ) => {

      canvas.toBlob(
        (blob) => {

          if (blob) {
            resolve(blob);
          } else {
            reject(
              new Error(
                'PNG export failed',
              ),
            );
          }
        },
        'image/png',
        0.96,
      );
    },
  );
}


/* =========================================================
   RESOLVE PHOTO DATA
========================================================= */

export async function resolvePhotoData(
  value: string,
  archive?: PhotoArchive,
): Promise<
  string | undefined
> {

  const result =
    findPhoto(
      value,
      archive,
    );

  if (!result) {
    return undefined;
  }

  /*
   * Already a data URL.
   */

  if (
    typeof result === 'string'
  ) {

    if (
      result.startsWith(
        'data:',
      )
    ) {
      return result;
    }

    /*
     * Remote URL.
     */

    try {

      const response =
        await fetch(
          result,
          {
            mode: 'cors',
          },
        );

      if (!response.ok) {
        return undefined;
      }

      const blob =
        await response.blob();

      return await fileToDataUrl(
        new File(
          [blob],
          'remote-photo',
        ),
      );

    } catch {
      return undefined;
    }
  }

  /*
   * Local file.
   */

  return await fileToDataUrl(
    result,
  );
}
