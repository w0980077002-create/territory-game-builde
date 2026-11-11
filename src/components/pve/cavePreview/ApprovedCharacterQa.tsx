import { useState } from 'react';
import characters from '../../../game/cavePreviewWorld/approvedCharacters.json';
import './approvedCharacterQa.css';

type Character = typeof characters[number];
const defaultUrl = (path: string) => import.meta.env.BASE_URL + path;

/** Art inspection in the existing cave entrance. These are deliberately still frames. */
export function ApprovedCharacterQa({ assetUrl = defaultUrl, en = false, onClose }: { assetUrl?: (path: string) => string; en?: boolean; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [checker, setChecker] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const selected = characters[index];
  const t = (ru: string, english: string) => en ? english : ru;
  const hero = selected.category === 'heroes' ? selected : characters[2];
  const enemy = ['heroes', 'companions'].includes(selected.category) ? characters[5] : selected;
  const actors = [characters[4], hero, characters[3], enemy];
  const url = (c: Character) => assetUrl(`assets/territory/cave-expedition/characters-v2/${c.category}/${c.id}/idle-still.webp`);
  return <section className="cq-root" aria-label={t('Проверка 21 персонажа', '21 character inspection')}>
    <header className="cq-header"><button autoFocus onClick={onClose}>{t('‹ К пещере', '‹ Back to cave')}</button><strong>{t('АРТ · 21 ПЕРСОНАЖ', 'ART · 21 CHARACTERS')}</strong></header>
    <p className="cq-notice">{t('СТОП-КАДРЫ · не анимация и не бой · без покупок и наград', 'STILL FRAMES · no animation or combat · no purchases or rewards')}</p>
    <div className={`cq-scene ${checker ? 'cq-checker' : ''}`} style={{ backgroundImage: checker ? undefined : `url("${assetUrl('assets/territory/cave-expedition/biomes.webp')}")` }} aria-label={t('Герой и два спутника слева, противник справа', 'Hero and two companions on the left, opponent on the right')}>
      <span className="cq-direction">{t('ОТРЯД →', 'PARTY →')}<span>{t('← ПРОТИВНИК', '← OPPONENT')}</span></span>
      <div className="cq-ground" />
      {actors.map((c, slot) => {
        const [x, y, right, bottom] = c.alpha_bbox;
        return <figure key={c.id} data-character={c.id} className={`cq-actor cq-slot-${slot} ${slot === 3 && c.category !== 'enemies' ? 'cq-large' : ''} ${c.id === selected.id ? 'cq-selected' : ''}`} style={{ aspectRatio: `${right - x}/${bottom - y}` }}>
          {failed.includes(c.id) ? <span role="alert">{t('Не загружен: ', 'Failed: ')}{c.id}</span> : <img src={url(c)} alt={en ? c.id.replace(/_/g, ' ') : c.display_name_ru} onError={() => setFailed(previous => previous.includes(c.id) ? previous : [...previous, c.id])} style={{ width: `${100 * c.master_width_px / (right - x)}%`, left: `${-100 * x / (right - x)}%`, top: `${-100 * y / (bottom - y)}%` }} />}
        </figure>;
      })}
    </div>
    <div className="cq-review">
      <label htmlFor="cq-character">{t('Персонаж', 'Character')} · {index + 1}/21</label>
      <select id="cq-character" value={index} onChange={e => setIndex(Number(e.target.value))}>{characters.map((c, i) => <option key={c.id} value={i}>{i + 1}. {en ? c.id : c.display_name_ru}</option>)}</select>
      <div className="cq-nav"><button onClick={() => setIndex((index + 20) % 21)}>{t('← Назад', '← Previous')}</button><button aria-pressed={checker} onClick={() => setChecker(!checker)}>{t('Прозрачность', 'Transparency')}</button><button onClick={() => setIndex((index + 1) % 21)}>{t('Далее →', 'Next →')}</button></div>
      <p className="cq-detail" aria-live="polite"><b>{selected.id}</b><br />{t('Ожидаемое направление: ', 'Expected facing: ')}{selected.expected_facing === 'left' ? t('влево', 'left') : t('вправо', 'right')}</p>
      <small>{t('Выбранная фигура отмечена золотом. Без зеркалирования. Сходство с оригиналом и ракурс требуют приёмки владельца.', 'The selected figure has a gold outline. No mirroring. Likeness and facing require owner review.')}</small>
    </div>
  </section>;
}
