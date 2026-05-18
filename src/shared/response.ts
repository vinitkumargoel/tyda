import { z } from "zod";

/**
 * Universal Swiggy MCP response envelope.
 *
 * Successful responses carry `data` (tool-specific payload) and an optional
 * human-readable `message`. Failures carry an `error` with a `message` and
 * optional `code`.
 */
export const okResponse = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.literal(true),
    data,
    message: z.string().optional(),
  });

export const errResponse = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string().optional(),
    message: z.string(),
  }),
});

export const response = <T extends z.ZodTypeAny>(data: T) =>
  z.union([okResponse(data), errResponse]);

export type OkResponse<T> = { success: true; data: T; message?: string };
export type ErrResponse = {
  success: false;
  error: { code?: string; message: string };
};
export type Response<T> = OkResponse<T> | ErrResponse;
