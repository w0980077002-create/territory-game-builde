/**
 * Mechanical SQL-catalogue synchronization ONLY. Never connects to Supabase.
 * The Postgres script remains a disabled-by-default staging proposal.
 */
import { readFile, writeFile } from 'node:fs/promises';

const directory=new URL('../../supabase/staged/',import.meta.url);
const catalog=JSON.parse(await readFile(new URL('territory_profession_stage8_catalog.json',directory),'utf8'));
const destination=new URL('territory_profession_stage8_backend.sql',directory);
const source=await readFile(destination,'utf8');
const delimiter='$stage8_catalog$';
const first=source.indexOf(delimiter);
const last=source.indexOf(`${delimiter}::jsonb`,first+delimiter.length);
if (first<0 || last<=first || source.indexOf(delimiter,last+delimiter.length)!==-1)
  throw new Error('Stage8 SQL catalogue markers not uniquely found');
const before=source.slice(first+delimiter.length,last);
const old=JSON.parse(before);
if (!Array.isArray(old) || old.length<20 || !Array.isArray(catalog.recipes)
    || catalog.recipes.length<old.length || source.indexOf(`'${catalog.version}'`)<0)
  throw new Error('Refusing incompatible Stage8 SQL/catalogue edit');
if (catalog.recipes.some((item)=>item.id?.includes(delimiter))) throw new Error('Unsafe dollar marker in recipe');
const updated=`${source.slice(0,first+delimiter.length)}${JSON.stringify(catalog.recipes)}${source.slice(last)}`;
await writeFile(destination,updated,'utf8');
console.log(`Synced ${old.length} -> ${catalog.recipes.length} Stage8 recipes in staged SQL (NO database changes).`);
