// Fixed-category CRUD -- shared by Settings' "Fixed categories" card and
// OnboardingFlow's commitments step, so there's one place for this logic
// instead of two drifting copies. Every function takes tmpl/month
// explicitly (rather than closing over component state) and writes
// db.template plus, when a month is actually open, that month's own copy
// too -- during onboarding there is no open month yet, so that half is
// naturally a no-op via the same `if (month)` guard used everywhere else
// in the app for this exact situation.
import db from './db.js';
import { GOAL_COLORS } from './constants.js';

// Pure/sync half of "add a category" -- picks a unique key + unused color,
// but doesn't write anywhere. Exported on its own so OnboardingFlow's
// commitments step (which holds its categories as local state until the
// user finishes the whole flow, not persisted per-edit like Settings does)
// can build the same shape without a premature db.template write.
export function buildCategory(existingCategories, name, color) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const baseKey = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'category';
  let key = baseKey;
  let n = 2;
  while (existingCategories.some((c) => c.key === key)) key = `${baseKey}-${n++}`;
  // Explicit color (Settings/OnboardingFlow now offer a picker) wins;
  // falling back to the old auto-pick-an-unused-one only when none was
  // given, so callers that predate the picker keep behaving the same.
  const usedColors = new Set(existingCategories.map((c) => c.color));
  const resolvedColor = color || GOAL_COLORS.find((c) => !usedColors.has(c)) || GOAL_COLORS[existingCategories.length % GOAL_COLORS.length];
  return { key, name: trimmed, color: resolvedColor, planned: 0 };
}

export async function addCategory(tmpl, month, name, color) {
  const newCat = buildCategory(tmpl.categories, name, color);
  if (!newCat) return null;
  await db.template.put({ ...tmpl, categories: [...tmpl.categories, newCat] });
  // buildCategory() returns a template-shaped category (no `actual` --
  // template categories never track spend). Every month-side category
  // needs one though, same as OnboardingFlow/EndMonthSheet always add
  // `actual: 0` when turning a template category into a month one --
  // skipping it here left the new category's `actual` as `undefined`,
  // which poisoned every calc.js reduce that does arithmetic on `c.actual`
  // (computeLiveAdjustment's `c.planned - c.actual`, computeCoreActual's
  // `s + c.actual`, ...) into NaN for the WHOLE month, not just this one
  // category -- and fmt()'s `Number(n) || 0` fallback silently displayed
  // that NaN as "0.00" everywhere it flowed (Buffer, and on the live
  // single-balance app, the account balance too).
  if (month) await db.months.update(month.key, { categories: [...month.categories, { ...newCat, actual: 0 }] });
  return newCat;
}

// Renaming is safe even for Saving: the pool/Goals link is keyed on `key`
// ('saving'), never the display name, so the label can be anything.
export async function renameCategory(tmpl, month, index, name) {
  const value = name.trim();
  if (!value) return false;
  const key = tmpl.categories[index].key;
  const updatedTemplate = tmpl.categories.map((c, i) => (i === index ? { ...c, name: value } : c));
  await db.template.put({ ...tmpl, categories: updatedTemplate });
  if (month) {
    const updatedMonth = month.categories.map((c) => (c.key === key ? { ...c, name: value } : c));
    await db.months.update(month.key, { categories: updatedMonth });
  }
  return true;
}

// Same write shape as renameCategory/updateCategoryPlanned -- template plus
// the current open month's own copy (if any), keyed by `key` so an
// in-progress month's categories stay in sync with a template edit.
export async function recolorCategory(tmpl, month, index, color) {
  const key = tmpl.categories[index].key;
  const updatedTemplate = tmpl.categories.map((c, i) => (i === index ? { ...c, color } : c));
  await db.template.put({ ...tmpl, categories: updatedTemplate });
  if (month) {
    const updatedMonth = month.categories.map((c) => (c.key === key ? { ...c, color } : c));
    await db.months.update(month.key, { categories: updatedMonth });
  }
}

// Swaps a category with its neighbor one slot up (-1) or down (+1), in both
// the template AND the current open month's own copy -- Home renders
// month.categories in ITS OWN stored order, not the template's, so
// reordering only the template would silently not move anything on Home
// until the next cycle. Re-sorts the month's array by the template's NEW
// key order rather than swapping indices directly there, since a month's
// categories can already differ in shape from the template's (extra
// per-entry fields like `actual`/`transactions`) even though the set of
// keys always matches.
export async function reorderCategory(tmpl, month, index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= tmpl.categories.length) return;
  const reordered = tmpl.categories.slice();
  [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];
  await db.template.put({ ...tmpl, categories: reordered });
  if (month) {
    const keyOrder = reordered.map((c) => c.key);
    const sortedMonthCats = keyOrder.map((k) => month.categories.find((c) => c.key === k)).filter(Boolean);
    await db.months.update(month.key, { categories: sortedMonthCats });
  }
}

export async function updateCategoryPlanned(tmpl, month, index, value) {
  const key = tmpl.categories[index].key;
  const updatedTemplate = tmpl.categories.map((c, i) => (i === index ? { ...c, planned: value } : c));
  await db.template.put({ ...tmpl, categories: updatedTemplate });
  if (month) {
    const updatedMonth = month.categories.map((c) => (c.key === key ? { ...c, planned: value } : c));
    await db.months.update(month.key, { categories: updatedMonth });
  }
}

// Deleting removes the category from the template and the current open
// month (closed months keep their frozen copy).
export async function deleteCategory(tmpl, month, index) {
  const cat = tmpl.categories[index];
  const updatedTemplate = tmpl.categories.filter((_, i) => i !== index);
  await db.template.put({ ...tmpl, categories: updatedTemplate });
  if (month) {
    const updatedMonth = month.categories.filter((c) => c.key !== cat.key);
    await db.months.update(month.key, { categories: updatedMonth });
  }
  return { name: cat.name };
}
