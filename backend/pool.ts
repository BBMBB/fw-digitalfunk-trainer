import { randomInt } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export type TaskType = 'drawing' | 'word' | 'message' | 'equipment';
export type Content = string | string[] | Record<string, string>;
export interface Exercise { id: string; type: TaskType; content: Content }

export function requiresAnswer(type: TaskType): boolean {
  return type === 'word' || type === 'equipment';
}

export function loadDrawings(directory = resolve('backend/drawings')): Exercise[] {
  let names: string[];
  try {
    names = readdirSync(directory, {withFileTypes: true})
      .filter(entry => entry.isFile() && !entry.name.startsWith('.') && entry.name.toLowerCase().endsWith('.svg'))
      .map(entry => entry.name)
      .sort();
  } catch {
    throw new Error('Der Skizzenordner konnte nicht gelesen werden.');
  }
  if (names.length === 0) throw new Error('Der Skizzenordner muss mindestens eine SVG-Datei enthalten.');
  // Der Dateiname bleibt die Aufgabenkennung, auch wenn neue Dateien hinzukommen.
  return names.map(name => ({id: `drawing-${name}`, type: 'drawing', content: name}));
}

// Nur das Backend lädt die Inhalte. Laufende Aufträge behalten ihre gespeicherten Inhalte.
export function loadPool(directory = resolve('backend/data')): Exercise[] {
  function read(name: string): unknown[] {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
    } catch {
      throw new Error(`Aufgabendatei ${name} fehlt oder enthält ungültiges JSON.`);
    }
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`Aufgabendatei ${name} muss eine nicht leere Liste enthalten.`);
    }
    return value;
  }
  const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 250;
  const words = read('words.json');
  const messages = read('messages.json');
  const equipment = read('equipment.json');
  if (!words.every(isText)) throw new Error('words.json muss eine Liste von Begriffen mit jeweils höchstens 250 Zeichen enthalten.');
  if (!messages.every(row => row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).length > 0 && Object.entries(row).every(([key, value]) => isText(key) && isText(value)))) {
    throw new Error('messages.json muss Meldungen mit benannten Textfeldern enthalten.');
  }
  if (!equipment.every(row => Array.isArray(row) && row.length === 6 && row.every(isText))) {
    throw new Error('equipment.json muss Listen mit jeweils sechs Gegenständen enthalten.');
  }
  return [
    ...words.map((content, i): Exercise => ({id: `word-${i+1}`, type: 'word', content: content as string})),
    ...messages.map((content, i): Exercise => ({id: `message-${i+1}`, type: 'message', content: content as Record<string, string>})),
    ...equipment.map((content, i): Exercise => ({id: `equipment-${i+1}`, type: 'equipment', content: content as string[]})),
    ...loadDrawings()
  ];
}
export const pool = loadPool();

export function pickExercise(previous: Exercise[]): Exercise {
  const types: TaskType[] = ['drawing','word','message','equipment'];
  const counts = types.map(t => previous.filter(x => x.type === t).length);
  const balanced = types.filter((_, i) => counts[i] === Math.min(...counts));
  const type = balanced[randomInt(balanced.length)];
  const used = new Set(previous.map(x => x.id));
  // Neue SVG-Dateien stehen ohne Backendneustart für neue Aufträge bereit.
  const exercises = type === 'drawing' ? loadDrawings() : pool.filter(x => x.type === type);
  const available = exercises.filter(x => !used.has(x.id));
  // Nach Erschöpfung zuerst den am längsten nicht verwendeten Inhalt wählen.
  const candidates = available.length ? available : exercises.sort((a,b) => previous.findLastIndex(x=>x.id===a.id)-previous.findLastIndex(x=>x.id===b.id)).slice(0,1);
  return candidates[randomInt(candidates.length)];
}
export function normalize(value: string): string {
  return value.normalize('NFC').trim().toLocaleUpperCase('de-DE').replaceAll('Ä','AE').replaceAll('Ö','OE').replaceAll('Ü','UE').replaceAll('ẞ','SS').replaceAll('ß','SS').replace(/\s+/g,' ');
}
export function evaluate(exercise: Exercise, answer: unknown): { correct: boolean; fields: boolean[] } {
  let fields: boolean[];
  const match = (expected: string, actual: unknown) => typeof actual === 'string' && normalize(expected) === normalize(actual);
  if (exercise.type === 'word') fields = [match(exercise.content as string, answer)];
  else if (exercise.type === 'equipment') fields = (exercise.content as string[]).map((x,i) => match(x, Array.isArray(answer) ? answer[i] : undefined));
  else throw new Error('Für Zeichnungen und Lagemeldungen gibt es keine automatische Prüfung.');
  return { correct: fields.every(Boolean), fields };
}
