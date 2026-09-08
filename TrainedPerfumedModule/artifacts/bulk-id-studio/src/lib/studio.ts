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

      // Photo is handled separately
      if (token.toLowerCase() === 'photo') {
        return '';
      }

      const header = mappings[token];

      return header && header !== '__ignore__'
        ? escapeXml(row[header] ?? '')
        : '';
    },
  );

  // Replace the existing Canva photo with the student's photo
  if (photoData) {
    const doc = new DOMParser().parseFromString(
      svg,
      'image/svg+xml',
    );

    const images = Array.from(
      doc.querySelectorAll('image'),
    );

    // Find the existing JPEG/sample photo in the Canva SVG
    let photoElement =
      images.find((image) => {
        const href =
          image.getAttribute('href') ||
          image.getAttribute('xlink:href') ||
          '';

        return (
          href.startsWith('data:image/jpeg') ||
          href.startsWith('data:image/jpg')
        );
      }) ?? null;

    // Fallback if the SVG has an explicit photo placeholder
    if (!photoElement) {
      photoElement =
        doc.querySelector('#photo-placeholder') ||
        doc.querySelector(
          '[data-placeholder="photo"]',
        );
    }

    if (photoElement) {
      // Keep the existing Canva frame dimensions and position
      photoElement.setAttribute(
        'href',
        photoData,
      );

      // Remove old SVG 1.1 image reference
      photoElement.removeAttribute(
        'xlink:href',
      );

      // Crop the student photo inside the existing frame
      photoElement.setAttribute(
        'preserveAspectRatio',
        'xMidYMid slice',
      );

      photoElement.setAttribute(
        'data-generated-photo',
        'true',
      );

      svg = new XMLSerializer().serializeToString(
        doc,
      );
    }
  }

  return svg;
}
