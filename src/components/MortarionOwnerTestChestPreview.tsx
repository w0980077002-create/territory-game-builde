import { ItemArt } from './ui/ItemArt';
import type { InventoryItem } from '@/game/types';

export const MORTARION_OWNER_TEST_MAIL_ID = 'f4db6d91-863f-4592-a210-8164bc7b1fea';

const mustSee: InventoryItem[] = [
  { id: 'mortarion_heart', name: 'Сердце Мортариона', icon: '💜', type: 'material', rarity: 'legendary', qty: 1, description: 'Шанс 0,3%' },
  { id: 'cow_awakening_stone', name: 'Камень пробуждения', icon: '💜', type: 'material', rarity: 'legendary', qty: 1, description: 'Шанс 0,05%' },
  { id: 'mortarion_soul_essence', name: 'Эссенция душ Мортариона', icon: '✦', type: 'material', rarity: 'epic', qty: 1, description: 'Редкий материал' },
];

/** Actual pre-grant mail UI. A QA mail contains a server-issued collection of
 * private, test-only inventory copies; the normal claim button is unchanged. */
export function MortarionOwnerTestChestPreview({ inventory, en }: { inventory: InventoryItem[]; en: boolean }) {
  const testItems = inventory.filter(item => item.ownerTest === true && item.id.startsWith('mortarion_owner_test_'));
  const fragmentCount = testItems.filter(item => item.canonicalItemId?.startsWith('trial_fragment_')).length;
  return <section data-testid="mortarion-owner-test-mail-preview"
    className="mb-2 rounded-lg border border-violet-400/50 bg-violet-950/30 p-2 text-amber-100">
    <div className="mb-2 flex items-center gap-2">
      <img src={import.meta.env.BASE_URL + 'assets/territory/ui/trial-loot/chest-legendary.svg'}
        className="h-14 w-14 shrink-0 object-contain" draggable={false} alt=""/>
      <div>
        <strong className="text-xs font-black text-amber-200">{en ? 'OWNER QA CHEST · TEST' : 'ПОЛНЫЙ ТЕСТОВЫЙ СУНДУК'}</strong>
        <p className="text-[10px] leading-4 text-amber-100/80">{en
          ? 'Exact rare-item art and rarity; copies cannot replace real Mortarion prizes.'
          : 'Точные изображения и редкость. Тестовые копии не заменяют настоящую награду Мортариона.'}</p>
      </div>
    </div>
    <div className="grid grid-cols-3 gap-1">
      {mustSee.map(item => <div key={item.id} className="min-w-0 rounded-lg border border-amber-600/40 bg-black/30 p-1 text-center">
        <ItemArt item={item} size={46} className="mx-auto"/>
        <strong className="mt-1 block text-[10px] leading-3">{item.name}</strong>
      </div>)}
    </div>
    <p className="mt-2 text-[11px]">📜 {en ? '12 blueprint fragment examples: two sets of 1/6–6/6.' : '12 фрагментов чертежей: два набора от 1/6 до 6/6.'}</p>
    <p className="mt-1 text-[11px] font-bold text-emerald-200" data-testid="mortarion-owner-test-material-count">
      {testItems.length === 15
        ? (en ? 'All 15 test items appear in inventory.' : 'Все 15 тестовых предметов есть в инвентаре.')
        : (en ? `In inventory: ${testItems.length}/15, fragments: ${fragmentCount}/12`
          : `В инвентаре: ${testItems.length}/15, фрагменты: ${fragmentCount}/12`)}
    </p>
    <p className="mt-1 text-[10px] text-slate-300">{en
      ? 'After claiming: Inventory → Materials for items; Hero for TOP-1 / TOP-2–3 / TOP-4–10 title, frame and medal previews. No gold, gems, rank, raid HP or real receipts are changed.'
      : 'После получения: Инвентарь → Материалы для предметов; Герой — переключение ТОП-1 / ТОП-2–3 / ТОП-4–10 для титула, рамки и медали. Золото, алмазы, рейтинг, HP босса и настоящая награда не меняются.'}</p>
  </section>;
}
