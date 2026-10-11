// ОДНОРАЗОВЫЙ КОД ЭКСПЕРИМЕНТА. В продукт не переносится.

var TARGET_WIDTH = 400;
var GAP = 100;

figma.showUI(__html__, { width: 380, height: 620 });

figma.clientStorage.getAsync('spikeToken').then(function (token) {
  figma.ui.postMessage({ type: 'token', token: token || '' });
});

// Точка под существующим контентом страницы: существующие узлы не двигаем.
function nextPosition() {
  var left = null;
  var bottom = null;
  figma.currentPage.children.forEach(function (node) {
    var box = node.absoluteBoundingBox;
    if (!box) return;
    if (left === null || box.x < left) left = box.x;
    if (bottom === null || box.y + box.height > bottom) bottom = box.y + box.height;
  });
  if (left === null) return { x: 0, y: 0 };
  return { x: left, y: bottom + GAP };
}

async function insertImage(bytes) {
  var before = figma.currentPage.children.length;
  var position = nextPosition();
  var image = figma.createImage(bytes);
  var size = await image.getSizeAsync();
  var rect = figma.createRectangle();
  rect.name = 'Mobile Gallery Spike';
  rect.resize(TARGET_WIDTH, Math.round((TARGET_WIDTH * size.height) / size.width));
  rect.x = position.x;
  rect.y = position.y;
  rect.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }];
  figma.viewport.scrollAndZoomIntoView([rect]);
  return {
    source: size.width + '×' + size.height,
    node: rect.width + '×' + rect.height,
    nodesBefore: before,
    nodesAfter: figma.currentPage.children.length,
  };
}

figma.ui.onmessage = async function (msg) {
  if (msg.type === 'saveToken') {
    await figma.clientStorage.setAsync('spikeToken', msg.token);
    return;
  }

  if (msg.type === 'insert') {
    try {
      var result = await insertImage(msg.bytes);
      figma.ui.postMessage({ type: 'insertResult', ok: true, result: result });
    } catch (error) {
      figma.ui.postMessage({ type: 'insertResult', ok: false, error: String(error) });
    }
    return;
  }

  // Проверка собственного fetch Figma в main-потоке (предположение A4).
  if (msg.type === 'mainFetch') {
    try {
      var response = await fetch(msg.url, { headers: { Authorization: 'Bearer ' + msg.token } });
      figma.ui.postMessage({ type: 'mainFetchResult', url: msg.url, text: 'HTTP ' + response.status });
    } catch (error) {
      figma.ui.postMessage({ type: 'mainFetchResult', url: msg.url, text: 'ошибка: ' + String(error) });
    }
  }
};
