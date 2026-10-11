// main-поток плагина: вставка, раскладка и учёт вставленных заданий (разделы 4.5 и 5.6 спецификации).

import { addInserted, parseInserted } from './inserted.ts';
import { parseLayout, place, type Box } from './layout.ts';
import { nodeSize } from './sizing.ts';

const INSERTED_KEY = 'insertedJobs';
const LAYOUT_KEY = 'layout';
const JOB_KEY = 'jobId';
const TOKEN_KEY = 'token';

type Request =
  | { type: 'check'; requestId: number; jobId: string }
  | { type: 'insert'; requestId: number; jobId: string; bytes: Uint8Array; width: number; height: number }
  | { type: 'queueEmpty'; requestId: number }
  | { type: 'getToken'; requestId: number }
  | { type: 'saveToken'; requestId: number; token: string };

figma.showUI(__html__, { width: 340, height: 300 });

// Узлы, вставленные с момента последней прокрутки области просмотра.
let unseen: SceneNode[] = [];

let storedList: string[] | null = null;
async function loadStoredList(): Promise<string[]> {
  if (storedList === null) storedList = parseInserted((await figma.clientStorage.getAsync(INSERTED_KEY)) ?? '');
  return storedList;
}

function documentList(): string[] {
  return parseInserted(figma.root.getPluginData(INSERTED_KEY));
}

function occupiedBoxes(page: PageNode): Box[] {
  return page.children.map((node) => node.absoluteBoundingBox).filter((box): box is Rect => box !== null);
}

// Один синхронный шаг без await: узел, метка в узле, список документа и раскладка появляются вместе.
function insertSync(jobId: string, bytes: Uint8Array, width: number, height: number): Box | null {
  const inserted = documentList();
  if (inserted.includes(jobId)) return null;

  const page = figma.currentPage;
  const size = nodeSize(width, height);
  const { box, state } = place(parseLayout(page.getPluginData(LAYOUT_KEY)), occupiedBoxes(page), size.height);
  const image = figma.createImage(bytes);
  const rect = figma.createRectangle();
  try {
    rect.name = 'Mobile Gallery';
    rect.resize(box.width, box.height);
    rect.x = box.x;
    rect.y = box.y;
    rect.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }];
    rect.setPluginData(JOB_KEY, jobId);
    figma.root.setPluginData(INSERTED_KEY, JSON.stringify(addInserted(inserted, jobId)));
    page.setPluginData(LAYOUT_KEY, JSON.stringify(state));
  } catch (error) {
    rect.remove();
    throw error;
  }
  unseen.push(rect);
  return box;
}

async function handle(request: Request): Promise<Record<string, unknown>> {
  if (request.type === 'check') {
    if (documentList().includes(request.jobId)) return { found: 'в списке документа' };
    if ((await loadStoredList()).includes(request.jobId)) return { found: 'в clientStorage' };
    return { found: null };
  }

  if (request.type === 'insert') {
    let box: Box | null;
    try {
      box = insertSync(request.jobId, request.bytes, request.width, request.height);
    } catch (error) {
      return { ok: false, error: String(error) };
    }
    storedList = addInserted(await loadStoredList(), request.jobId);
    await figma.clientStorage.setAsync(INSERTED_KEY, JSON.stringify(storedList));
    return box ? { ok: true, box } : { ok: true, found: 'в списке документа' };
  }

  if (request.type === 'getToken') {
    return { token: (await figma.clientStorage.getAsync(TOKEN_KEY)) ?? '' };
  }

  if (request.type === 'saveToken') {
    await figma.clientStorage.setAsync(TOKEN_KEY, request.token);
    return {};
  }

  const visible = unseen.filter((node) => !node.removed && node.parent === figma.currentPage);
  unseen = [];
  if (visible.length > 0) figma.viewport.scrollAndZoomIntoView(visible);
  return {};
}

figma.ui.onmessage = async (request: Request) => {
  const reply = await handle(request);
  figma.ui.postMessage({ ...reply, requestId: request.requestId });
};
