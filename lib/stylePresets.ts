import { QuoteItem } from "@/lib/types";

export type StylePreset = {
  styleName: string;
  materials: Omit<QuoteItem, "section" | "lineTotal">[];
};

export const STYLE_PRESETS: StylePreset[] = [
  {
    styleName: "Standard Privacy",
    materials: []
  }
];

export function getStylePreset(styleName: string): StylePreset | undefined {
  return STYLE_PRESETS.find((p) => p.styleName === styleName);
}
