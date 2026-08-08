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
export function buildCategory(existingCategories, name) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const baseKey = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'category';
  let key = baseKey;
  let n = 2;
  while (existingCategories.some((c) => c.key === key)) key = `${baseKey}-${n++}`;
  const usedColors = new Set(existingCategories.map((c) => c.color));
  const color = GOAL_COLORS.find((c) => !usedColors.has(c)) || GOAL_COLORS[existingCategories.length % GOAL_COLORS.length];
  return { key, name: trimmed, color, planned: 0 };
}

export async function addCategory(tmpl, month, name) {
  const newCat = buildCategory(tmpl.categories, name);
  if (!newCat) return null;
  await db.template.put({ ...tmpl, categories: [...tmpl.categories, newCat] });
  if (month) await db.months.update(month.key, { categories: [...month.categories, { ...newCat }] });
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
// month (closed months keep their frozen copy). Saving is protected -- it
// feeds the Goals pool and the savings flow, so it can never be deleted.
export async function deleteCategory(tmpl, month, index) {
  const cat = tmpl.categories[index];
  if (cat.key === 'saving') return { blocked: true, name: cat.name };
  const updatedTemplate = tmpl.categories.filter((_, i) => i !== index);
  await db.template.put({ ...tmpl, categories: updatedTemplate });
  if (month) {
    const updatedMonth = month.categories.filter((c) => c.key !== cat.key);
    await db.months.update(month.key, { categories: updatedMonth });
  }
  return { blocked: false, name: cat.name };
}
