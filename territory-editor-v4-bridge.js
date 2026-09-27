/* Territory Game Editor V4 bridge */
(()=>{const open=()=>window.TerritoryEditorV3?.open?.();
window.TerritoryEditorOpen=open;
const patch=()=>{if(window.TerritoryNavigation?.fireHome){const old=window.TerritoryNavigation.fireHome;window.TerritoryNavigation.fireHome=(a)=>a==='settings'?(open(),true):old(a)}};
addEventListener('DOMContentLoaded',patch);setTimeout(patch,0);
document.addEventListener('click',e=>{const h=e.target?.closest?.('.hz[data-action="settings"],[data-home-action="settings"]');if(h){e.preventDefault();e.stopImmediatePropagation();open()}},{capture:true});
})();