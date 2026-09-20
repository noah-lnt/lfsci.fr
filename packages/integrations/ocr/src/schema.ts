import { z } from "zod";

export const OcrImage = z.object({
  id: z.string(),
  top_left_x: z.number().nullable().optional(),
  top_left_y: z.number().nullable().optional(),
  bottom_right_x: z.number().nullable().optional(),
  bottom_right_y: z.number().nullable().optional(),
  image_base64: z.string().nullable().optional(),
});

export const OcrDimensions = z.object({
  dpi: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
});

export const OcrPage = z.object({
  index: z.number().int(),
  markdown: z.string(),
  images: z.array(OcrImage).optional(),
  dimensions: OcrDimensions.nullable().optional(),
});
export type OcrPage = z.infer<typeof OcrPage>;

export const OcrResponse = z.object({
  pages: z.array(OcrPage),
  model: z.string(),
  usage_info: z
    .object({
      pages_processed: z.number().int().optional(),
      doc_size_bytes: z.number().int().nullable().optional(),
    })
    .optional(),
});

export type OcrUsage = { pagesProcessed: number; documentSizeBytes: number | undefined };

export type OcrResult = {
  pages: OcrPage[];
  model: string;
  usage: OcrUsage;
};
