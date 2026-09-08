import { NextRequest, NextResponse } from "next/server";

export interface ParsedTemplateResult {
  tokens: string[];
  hasPhotoPlaceholder: boolean;
  cleanSvg: string;
}

/**
 * Parses SVG content and extracts template tokens and placeholders.
 * Handles space tolerances and missing bracket typos automatically.
 */
export function parseSvgTemplate(svgContent: string): ParsedTemplateResult {
  if (!svgContent) {
    return {
      tokens: [],
      hasPhotoPlaceholder: false,
      cleanSvg: "",
    };
  }

  // 1. Flexible Regex: Matches {{Token}}, {{ Token }}, and {{Token} (tolerates missing closing bracket)
  const tokenRegex = /\{\{\s*([a-zA-Z0-9_\s-]+?)\s*\}?\}/g;

  const foundTokens = new Set<string>();
  let match: RegExpExecArray | null;

  // Extract all unique token keys
  while ((match = tokenRegex.exec(svgContent)) !== null) {
    if (match[1]) {
      foundTokens.add(match[1].trim());
    }
  }

  // 2. Check for photo placeholder (matches id, class, or text token containing 'photo' or 'image')
  const photoRegex = /(id|class)=["'](?:\w*-)*?(photo|image|avatar|picture)(?:-\w*)*?["']|\{\{\s*(photo|image)\s*\}?\}/i;
  const hasPhotoPlaceholder = photoRegex.test(svgContent);

  // 3. Normalize SVG text node breaks (join broken tspans for clean rendering)
  let cleanedSvg = svgContent.replace(
    /\{\{\s*([a-zA-Z0-9_\s-]+?)\s*\}?\}/g,
    (_fullMatch, tokenName) => `{{${tokenName.trim()}}}`
  );

  return {
    tokens: Array.from(foundTokens),
    hasPhotoPlaceholder,
    cleanSvg: cleanedSvg,
  };
}

/**
 * Replaces token keys in the SVG with actual mapping data for bulk generation.
 */
export function renderSvgWithData(
  svgTemplate: string,
  dataRecord: Record<string, string>
): string {
  let renderedSvg = svgTemplate;

  // Replace each mapped key with its value
  Object.entries(dataRecord).forEach(([key, value]) => {
    const safeValue = (value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

    // Replace {{Key}}, {{ Key }}, and broken bracket variants
    const replaceRegex = new RegExp(`\\{\\{\\s*${key}\\s*\\}?\\}`, "gi");
    renderedSvg = renderedSvg.replace(replaceRegex, safeValue);
  });

  return renderedSvg;
}

// API Route Handler (Next.js App Router)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { svgContent, dataRecords } = body;

    if (!svgContent) {
      return NextResponse.json(
        { error: "SVG content is required" },
        { status: 400 }
      );
    }

    // Parse template fields
    const parsed = parseSvgTemplate(svgContent);

    // If data records are passed, render generated outputs
    let renderedOutputs: string[] = [];
    if (Array.isArray(dataRecords) && dataRecords.length > 0) {
      renderedOutputs = dataRecords.map((record) =>
        renderSvgWithData(parsed.cleanSvg, record)
      );
    }

    return NextResponse.json({
      success: true,
      tokens: parsed.tokens,
      hasPhotoPlaceholder: parsed.hasPhotoPlaceholder,
      totalFieldsFound: parsed.tokens.length,
      renderedCount: renderedOutputs.length,
      renderedOutputs,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to parse template" },
      { status: 500 }
    );
  }
}
