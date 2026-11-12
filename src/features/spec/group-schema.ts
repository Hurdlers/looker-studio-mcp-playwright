import { z } from 'zod';
import { LookerError } from '../../core/errors.js';

const finite = z.number().finite();
const hex = z.string().regex(/^(?:#[a-f\d]{3}|#[a-f\d]{6}|transparent)$/i);
const color = z.union([hex, z.strictObject({ color: hex, opacity: finite.min(0).max(1).optional() })]);
export const groupAttributesSchema = z.strictObject({
  top: finite.optional(), left: finite.optional(), width: finite.min(0).optional(), height: finite.min(0).optional(),
  rotation: finite.optional(), flipHorizontal: z.boolean().optional(), flipVertical: z.boolean().optional(),
});
export const groupAppearanceSchema = z.strictObject({
  sectionType: z.literal(0).optional(),
  groupAlignment: z.strictObject({}).optional(),
  backgroundAndBorderProperty: z.strictObject({
    background: color.optional(), opacity: finite.min(0).max(1).optional(), boxShadow: z.boolean().optional(),
    border: z.strictObject({ color: color.optional(), opacity: finite.min(0).max(1).optional(),
      size: finite.min(0).optional(), style: z.number().int().min(0).max(3).optional(), radius: finite.min(0).optional() }).optional(),
  }).optional(),
});
export const groupSchema = z.strictObject({
  key: z.string().trim().min(1).max(128),
  components: z.array(z.number().int().min(0)).default([]),
  children: z.array(z.string().trim().min(1).max(128)).default([]),
  inherit_filters: z.boolean().optional(),
  control_state_passthrough: z.boolean().optional(),
  attributes: groupAttributesSchema.optional(), appearance: groupAppearanceSchema.optional(),
});
export type PortableGroup = z.infer<typeof groupSchema>;

/** Validate a page-local forest. A component has one direct owner, groups have
 * at most one parent, and references never address another page or raw ID. */
export function validatePageGroups(page: { components: Array<Record<string, any>>; groups?: PortableGroup[] | undefined }, path = 'page'): void {
  if (page.groups === undefined) return;
  const parsed = z.array(groupSchema).safeParse(page.groups);
  const fail = (message: string): never => { throw new LookerError('invalid', `${path}.groups: ${message}`); };
  if (!parsed.success) fail(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  const groups = parsed.success ? parsed.data : [];
  const byKey = new Map<string, PortableGroup>(), owner = new Map<number, string>(), parent = new Map<string, string>();
  for (const group of groups) {
    if (byKey.has(group.key)) fail(`Duplicate group key "${group.key}".`);
    byKey.set(group.key, group);
    if (!group.components.length && !group.children.length) fail(`Group "${group.key}" is empty.`);
    for (const index of group.components) {
      if (index >= page.components.length) fail(`Group "${group.key}" has out-of-range component index ${index}.`);
      if (page.components[index]?.component === 'other') fail(`Group "${group.key}" refers to an unsupported component ${index}.`);
      if (owner.has(index)) fail(`Component ${index} has duplicate group ownership (${owner.get(index)}, ${group.key}).`);
      owner.set(index, group.key);
    }
    for (const child of group.children) {
      if (parent.has(child)) fail(`Group "${child}" has duplicate parent references.`);
      parent.set(child, group.key);
    }
  }
  const visiting = new Set<string>(), done = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) fail(`Group cycle at "${key}".`);
    if (done.has(key)) return;
    const group = byKey.get(key); if (!group) fail(`Missing child group "${key}".`);
    visiting.add(key); for (const child of group!.children) visit(child); visiting.delete(key); done.add(key);
  };
  for (const group of groups) visit(group.key);
}
