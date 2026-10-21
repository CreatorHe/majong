import { createLibraryPlayer } from './library-player.js';

let dependencies;
function script(path, ready) {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const node = document.createElement('script');
    const timeout = setTimeout(() => { node.remove(); reject(new Error('结算画面加载超时')); }, 12000);
    node.src = new URL(path, import.meta.url).href;
    node.async = true;
    node.onload = () => { clearTimeout(timeout); ready() ? resolve() : reject(new Error('结算画面运行库不可用')); };
    node.onerror = () => { clearTimeout(timeout); node.remove(); reject(new Error('结算画面加载失败')); };
    document.head.append(node);
  });
}

/** Local runtime only; neither this module nor the renderer owns game state. */
export async function createRuntimePlayer(options = {}) {
  if (!dependencies) {
    dependencies = script('vendor/pixi/pixi.min.js', () => !!globalThis.PIXI?.Application)
      .then(() => script('vendor/pixi/pixi-filters.js', () => !!globalThis.PIXI?.filters?.AdjustmentFilter));
    dependencies.catch(() => { dependencies = null; });
  }
  await dependencies;
  if (options.signal?.aborted) throw new Error('结算演出已取消');
  return createLibraryPlayer(options);
}
