import { z } from "zod";
export const metadataSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()),
  createdAt: z.iso.date(),
  updatedAt: z.iso.datetime(),
  hidden: z.boolean(),
  public: z.boolean(),
});
export type Prototype = z.infer<typeof metadataSchema> & {
  slug: string;
  light: boolean;
  dark: boolean;
};
