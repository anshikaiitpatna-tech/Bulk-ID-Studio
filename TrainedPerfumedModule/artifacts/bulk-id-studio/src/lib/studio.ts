import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

export type SpreadsheetRow = Record<string, string>;

export type PhotoArchive = {
  files: Record<string, File>;
  names: string[];
};

export type PhotoPlaceholder = {
  x: number;
  y: number;
  width: number;
  height: number;
  source: string;
};

export type ParsedTemplate = {
  rawSvg: string;
  tokens: string[];
  photoPlaceholder?: PhotoPlaceholder;
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

const cleanToken = (value: string) =>
  value.trim().replace(/^\{\{|\}\}$/g, '').trim();

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

/**
 * Parse SVG template and detect text/photo placeholders.
 */
export function parseSvgTemplate(rawSvg: string): ParsedTemplate {
  const found = new Set<string>();

  // Detect normal {{Field}} tokens
  for (const match of rawSvg.matchAll(
    /\{\{\s*([^}]+?)\s*\}\}/g,
  )) {
    found.add(cleanToken(match[1]));
  }

  const doc = new DOMParser().parseFromString(
    rawSvg,
    'image/svg+xml',
  );

  let photo: PhotoPlaceholder | undefined;

  const elements = Array.from(doc.querySelectorAll('*'));

  for (const element of elements) {
    const text = element.textContent?.trim() ?? '';
    const id =
      element.getAttribute('id')?.toLowerCase() ?? '';
    const placeholder =
      element
        .getAttribute('data-placeholder')
        ?.toLowerCase() ?? '';

    const isPhotoToken =
      element.tagName.toLowerCase() === 'text' &&
      /\{\{\s*photo\s*\}\}/i.test(text);

    const isPhoto =
      id === 'photo-placeholder' ||
      placeholder === 'photo' ||
      isPhotoToken;

    if (!isPhoto) continue;

    found.add('Photo');

    const viewBox = doc.documentElement
      .getAttribute('viewBox')
      ?.split(/\s+/)
      .map(Number);

    const viewWidth = viewBox?.[2] ?? 640;
    const viewHeight = viewBox?.[3] ?? 900;

    const fallbackWidth = viewWidth * 0.28;
    const fallbackHeight =
      fallbackWidth / 0.72;

    const geometry =
      element.matches(
        'rect, circle, ellipse, image',
      )
        ? element
        : element.querySelector(
            'rect, circle, ellipse, image',
          );

    const xAttribute =
      geometry?.getAttribute('x');

    const yAttribute =
      geometry?.getAttribute('y');

    const widthAttribute =
      geometry?.getAttribute('width');

    const heightAttribute =
      geometry?.getAttribute('height');

    const radius = numeric(
      geometry?.getAttribute('r') ?? null,
      0,
    );

    const resolvedWidth =
      widthAttribute != null
        ? numeric(
            widthAttribute,
            fallbackWidth,
          )
        : radius > 0
          ? radius * 2
          : fallbackWidth;

    const resolvedHeight =
      heightAttribute != null
        ? numeric(
            heightAttribute,
            fallbackHeight,
          )
        : radius > 0
          ? radius * 2
          : fallbackHeight;

    const fallbackX =
      (viewWidth - resolvedWidth) / 2;

    const fallbackY =
      viewHeight * 0.22;

    const x =
      xAttribute != null
        ? numeric(xAttribute, fallbackX)
        : fallbackX;

    const y =
      yAttribute != null
        ? numeric(yAttribute, fallbackY)
        : fallbackY;

    photo = {
      x,
      y,
      width: resolvedWidth,
      height: resolvedHeight,
      source:
        geometry?.tagName.toLowerCase() ??
        element.tagName.toLowerCase(),
    };

    break;
  }

  if (!photo && found.has('Photo')) {
    const viewBox = doc.documentElement
      .getAttribute('viewBox')
      ?.split(/\s+/)
      .map(Number);

    photo = {
      x: (viewBox?.[2] ?? 640) / 2 - 60,
      y: (viewBox?.[3] ?? 900) / 2 - 75,
      width: 120,
      height: 150,
      source: 'token',
    };
  }

  return {
    rawSvg,
    tokens: Array.from(found),
    photoPlaceholder: photo,
  };
}

/**
 * Render one student's data into the SVG.
 *
 * IMPORTANT:
 * The student's photo replaces the existing
 * photo placeholder instead of adding a second image.
 */
export function renderSvgForRow(
  template: ParsedTemplate,
  row: SpreadsheetRow,
  mappings: FieldMapping,
  photoData?: string,
) {
  let svg = template.rawSvg.replace(
    /\{\{\s*([^}]+?)\s*\}\}/g,
    (_match, rawToken: string) => {
      const token = cleanToken(rawToken);

      // Photo is handled separately.
      if (token.toLowerCase() === 'photo') {
        return '';
      }

      const header = mappings[token];

      return header &&
        header !== '__ignore__'
        ? escapeXml(row[header] ?? '')
        : '';
    },
  );

  /**
   * Replace the EXISTING photo placeholder.
   */
  if (template.photoPlaceholder && photoData) {
    const doc = new DOMParser().parseFromString(
      svg,
      'image/svg+xml',
    );

    // First try explicit placeholder markers.
    let photoElement =
      doc.querySelector('#photo-placeholder') ||
      doc.querySelector(
        '[data-placeholder="photo"]',
      );

    /**
     * If the SVG has {{Photo}} represented by
     * an image element, try to find that image.
     */
    if (!photoElement) {
      const images = Array.from(
        doc.querySelectorAll('image'),
      );

      photoElement =
        images.find((image) => {
          const id =
            image.getAttribute('id')
              ?.toLowerCase() ?? '';

          const dataPlaceholder =
            image.getAttribute(
              'data-placeholder',
            )?.toLowerCase() ?? '';

          return (
            id.includes('photo') ||
            id.includes('image') ||
            id.includes('avatar') ||
            dataPlaceholder === 'photo'
          );
        }) ?? null;
    }

    if (photoElement) {
      /**
       * IMPORTANT:
       * Design tools like Figma/Illustrator almost always export a plain
       * placeholder shape as <rect>, <circle>, or <ellipse> — never as a
       * real <image> element, even if "Photo" is just a visual box in the
       * design. Setting `href` on a rect/circle/ellipse does nothing (SVG
       * only renders images through an <image> element), so the swapped
       * photo would silently fail to appear.
       *
       * To stay compatible with any template regardless of the tool that
       * exported it, convert the placeholder into a real <image> element
       * (preserving its id/position/clip so it still lines up with the
       * design) before writing the photo into it.
       */
      let imageElement = photoElement;

      if (
        photoElement.tagName.toLowerCase() !==
        'image'
      ) {
        imageElement = doc.createElementNS(
          'http://www.w3.org/2000/svg',
          'image',
        );

        const radius = numeric(
          photoElement.getAttribute('r'),
          0,
        );

        const x =
          photoElement.getAttribute('x') ??
          (radius > 0
            ? String(
                numeric(
                  photoElement.getAttribute(
                    'cx',
                  ),
                  0,
                ) - radius,
              )
            : String(
                template.photoPlaceholder.x,
              ));

        const y =
          photoElement.getAttribute('y') ??
          (radius > 0
            ? String(
                numeric(
                  photoElement.getAttribute(
                    'cy',
                  ),
                  0,
                ) - radius,
              )
            : String(
                template.photoPlaceholder.y,
              ));

        const width =
          photoElement.getAttribute(
            'width',
          ) ??
          (radius > 0
            ? String(radius * 2)
            : String(
                template.photoPlaceholder
                  .width,
              ));

        const height =
          photoElement.getAttribute(
            'height',
          ) ??
          (radius > 0
            ? String(radius * 2)
            : String(
                template.photoPlaceholder
                  .height,
              ));

        imageElement.setAttribute('x', x);
        imageElement.setAttribute('y', y);
        imageElement.setAttribute(
          'width',
          width,
        );
        imageElement.setAttribute(
          'height',
          height,
        );

        // Carry over anything that affects how/where it renders
        // (id so future lookups keep working, plus clip/mask/transform
        // so the photo stays cropped and positioned like the original shape).
        for (const attribute of [
          'id',
          'clip-path',
          'transform',
          'mask',
        ]) {
          const value =
            photoElement.getAttribute(
              attribute,
            );

          if (value) {
            imageElement.setAttribute(
              attribute,
              value,
            );
          }
        }

        photoElement.parentNode?.replaceChild(
          imageElement,
          photoElement,
        );
      }

      /**
       * Keep the existing x/y/width/height.
       * This preserves the original frame position.
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

      // Remove old SVG 1.1 image reference.
      imageElement.removeAttribute(
        'xlink:href',
      );

      svg = new XMLSerializer()
        .serializeToString(doc);
    }
  }

  return svg;
}

/**
 * Render SVG to PNG.
 */
export async function renderSvgToPng(
  svgText: string,
): Promise<Blob> {
  const blob = new Blob(
    [svgText],
    { type: 'image/svg+xml' },
  );

  const url = URL.createObjectURL(blob);

  try {
    const image = new Image();

    await new Promise<void>(
      (resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () =>
          reject(
            new Error(
              'Failed to load rendered SVG',
            ),
          );

        image.src = url;
      },
    );

    const width =
      image.naturalWidth || 640;

    const height =
      image.naturalHeight || 900;

    const canvas =
      document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;

    const context =
      canvas.getContext('2d');

    if (!context) {
      throw new Error(
        'Could not create canvas context',
      );
    }

    context.drawImage(
      image,
      0,
      0,
      width,
      height,
    );

    return await new Promise<Blob>(
      (resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) {
              resolve(result);
            } else {
              reject(
                new Error(
                  'Failed to create PNG',
                ),
              );
            }
          },
          'image/png',
        );
      },
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
