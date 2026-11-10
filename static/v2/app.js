/* PackPilot UI. All quotation arithmetic lives in engine.js. */
(() => {
  'use strict';
  const E = window.PackPilot;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n = (value, digits=2) => Number(value).toLocaleString('zh-CN', {minimumFractionDigits:digits,maximumFractionDigits:digits});
  const yuan = value => '¥' + n(value);
  const names = {'three-side':'三边封 / 竖切袋','back-seal':'背封 / 中封袋','four-lane':'四联袋',custom:'其他袋型'};
  const positionName = {outer:'外膜',middle:'中膜',inner:'内膜'};
  const basisName = {qualified:'预计合格数量',theoretical:'理论整袋数量',billable:'本单可结算数量'};
  let config = E.defaultConfig(), result, toastTimer;
  const storageKey = 'zhenghao-packpilot-v2-draft';
  const selectionKey = 'zhenghao-packpilot-v2-selected-spec';
  let library, specs = [], activeId = null, savedSignature = null, busy = false;
  const signature = value => JSON.stringify(value);
  const dirty = () => savedSignature === null || signature(config) !== savedSignature;
  function selectedSpec() { return specs.find(item => item.id === activeId); }
  function rememberSelection() {
    try { if(activeId)localStorage.setItem(selectionKey,activeId);else localStorage.removeItem(selectionKey); } catch { /* Selection is only a convenience; the repository reports persistence errors. */ }
  }
  function updateLibraryUI() {
    const selected = selectedSpec();
    $('#spec-select').replaceChildren(...specs.map(item=>{
      const option=document.createElement('option');option.value=item.id;
      option.textContent=`${item.name} · ${item.config.widthMm} × ${item.config.heightMm} mm`;
      return option;
    }));
    const placeholder=document.createElement('option');placeholder.value='';
    placeholder.textContent=specs.length?'未保存的工作参数':'规格库为空，请新增规格';
    $('#spec-select').prepend(placeholder);$('#spec-select').value=activeId||'';
    $('#spec-select').disabled=!library||busy||!specs.length;
    $('#new-spec').disabled=!library||busy;
    $('#copy-spec').disabled=!library||busy;
    $('#save-spec').disabled=!library||busy||!selected||!dirty();
    $('#delete-spec').disabled=!library||busy||!selected;
    $('#save-status').textContent=library?(library.mode==='database'?'数据库规格库':'本机浏览器规格库'):'本地计算 · 规格库未连接';
    $('#spec-status').textContent=busy?'正在处理…':selected?(dirty()?'有未保存修改':'已加载 · '+(library?.mode==='database'?'数据库已保存':'本机已保存')):'当前参数未存入规格库';
  }
  function libraryError(error) {
    $('#library-error').textContent=error.message||'规格库操作失败，请重试。';
    $('#library-error').hidden=false;
    $('#retry-specs').hidden=false;
  }
  async function runLibraryAction(action) {
    if(busy)return;
    busy=true;updateLibraryUI();$('#library-error').hidden=true;
    try { await action(); }
    catch(error) { libraryError(error);toast(error.message||'操作失败，未保存。'); }
    finally { busy=false;updateLibraryUI(); }
  }
  function loadSpec(item) {
    config=E.normalizeConfig(item.config);activeId=item.id;savedSignature=signature(config);
    rememberSelection();populate();
  }
  async function saveCurrent() {
    const selected=selectedSpec();if(!selected)throw Error('请先新增规格或复制为新规格。');
    const submitted=structuredClone(config), before=signature(config);
    const item=await library.update(selected.id,submitted,selected.revision);
    specs=specs.map(old=>old.id===item.id?item:old);savedSignature=signature(E.normalizeConfig(item.config));
    if(signature(config)===before){config=E.normalizeConfig(item.config);populate();}
    toast('已保存规格及全部报价参数。');return true;
  }
  function askConfirmation(title,message,choices) {
    return new Promise(resolve=>{
      const dialog=$('#confirm-dialog');$('#confirm-title').textContent=title;$('#confirm-message').textContent=message;
      $('#confirm-actions').replaceChildren(...choices.map(choice=>{
        const button=document.createElement('button');button.type='button';button.textContent=choice.label;
        button.className='button '+(choice.style||'');button.addEventListener('click',()=>{dialog.returnValue=choice.value;dialog.close();});
        return button;
      }));
      dialog.returnValue='cancel';dialog.addEventListener('close',()=>resolve(dialog.returnValue),{once:true});dialog.showModal();
      $('#confirm-actions button').focus();
    });
  }
  async function leaveCurrent() {
    if(!dirty())return true;
    const choices=[{label:'取消',value:'cancel'}];
    if(selectedSpec())choices.push({label:'保存并继续',value:'save',style:'primary'});
    choices.push({label:'放弃修改并继续',value:'discard'});
    const decision=await askConfirmation('当前参数尚未保存','切换后会放弃当前未保存的参数。',choices);
    if(decision==='save')return saveCurrent();
    return decision==='discard';
  }
  function askName(copy) {
    return new Promise(resolve=>{
      const dialog=$('#spec-dialog');$('#spec-dialog-title').textContent=copy?'复制为新规格':'新增规格';
      $('#spec-dialog-description').textContent=copy?'完整复制当前报价参数，原规格保持不变。':'先命名，再在报价区调整参数并保存修改。';
      $('#spec-name').value=copy?String(config.name||'规格').slice(0,96)+' 副本':'';
      $('#spec-name-form button[type="submit"]').textContent=copy?'创建副本':'创建规格';
      dialog.returnValue='';dialog.addEventListener('close',()=>resolve(dialog.returnValue||null),{once:true});dialog.showModal();$('#spec-name').focus();
    });
  }
  $('#spec-name-form').addEventListener('submit',event=>{event.preventDefault();const name=$('#spec-name').value.trim();if(!name){$('#spec-name').setCustomValidity('请输入规格名称。');$('#spec-name').reportValidity();return;}$('#spec-dialog').returnValue=name;$('#spec-dialog').close();});
  $('#spec-name').addEventListener('input',()=>$('#spec-name').setCustomValidity(''));
  $('#spec-name-cancel').addEventListener('click',()=>$('#spec-dialog').close());
  $('#spec-select').addEventListener('change',()=>{
    const id=$('#spec-select').value;$('#spec-select').value=activeId||'';if(!id||id===activeId)return;
    runLibraryAction(async()=>{if(!await leaveCurrent())return;const item=specs.find(x=>x.id===id);if(item){loadSpec(item);toast('已加载规格并重新核价。');}});
  });
  $('#new-spec').addEventListener('click',()=>runLibraryAction(async()=>{
    if(!await leaveCurrent())return;const name=await askName(false);if(!name)return;
    const next=E.defaultConfig();next.name=name;const item=await library.create(next);
    specs.push(item);loadSpec(item);showTab('product');toast('已新增规格；调整参数后请保存修改。');
  }));
  $('#copy-spec').addEventListener('click',()=>runLibraryAction(async()=>{
    const name=await askName(true);if(!name)return;
    const next=structuredClone(config);next.name=name;const item=await library.create(next);
    specs.push(item);loadSpec(item);toast('已完整复制为新规格。');
  }));
  $('#save-spec').addEventListener('click',()=>runLibraryAction(saveCurrent));
  $('#delete-spec').addEventListener('click',()=>runLibraryAction(async()=>{
    const item=selectedSpec();if(!item)return;
    const decision=await askConfirmation('删除规格？',`确认删除“${item.name}”？删除后无法恢复${dirty()?'，当前未保存修改也将放弃':''}。`,[{label:'取消',value:'cancel'},{label:'确认删除',value:'delete',style:'danger'}]);
    if(decision!=='delete')return;
    await library.remove(item.id,item.revision);specs=specs.filter(x=>x.id!==item.id);
    if(specs.length)loadSpec(specs[0]);else{activeId=null;config=E.defaultConfig();savedSignature=signature(config);rememberSelection();populate();}
    toast('已删除规格。');
  }));
  async function initializeLibrary() {
    const initialSignature=signature(config);
    try {
      let browserStorage;try{browserStorage=window.localStorage;}catch{}
      library=await window.PackPilotSpecs.open({engine:E,storage:browserStorage,fetch:window.fetch.bind(window),remote:location.protocol!=='file:'&&/\/v2(?:\/|$)/.test(location.pathname)});
      specs=await library.list();
      $('#storage-description').textContent=library.mode==='database'?'规格已保存到此网站的持久化数据库；同一账号可跨设备加载。临时草稿仍只保存在当前浏览器。':'规格保存在本机浏览器 localStorage，仅同设备、同浏览器、同网址有效；清除网站数据或使用隐私模式可能丢失。请下载核价 JSON 备份。';
      let remembered;try{remembered=localStorage.getItem(selectionKey);}catch{}
      const item=specs.find(x=>x.id===remembered)||specs[0];
      if(signature(config)!==initialSignature){activeId=null;savedSignature=null;updateLibraryUI();toast('已连接规格库，当前编辑参数保留，请复制为新规格保存。');}
      else if(item)loadSpec(item);else{activeId=null;savedSignature=signature(config);updateLibraryUI();}
      $('#retry-specs').hidden=true;$('#library-error').hidden=true;
    }catch(error){library=null;libraryError(error);$('#retry-specs').hidden=false;$('#storage-description').textContent='规格库未连接，当前参数尚未保存。可下载 JSON 留档后重试。';updateLibraryUI();}
  }
  $('#retry-specs').addEventListener('click',()=>{if(!busy)runLibraryAction(async()=>{if(!await leaveCurrent())return;await initializeLibrary();});});
  window.addEventListener('beforeunload',event=>{if(dirty()&&library){event.preventDefault();event.returnValue='';}});
  function toast(message) { $('#toast').textContent=message; $('#toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').hidden=true,4200); }
  function fieldGet(path) {return path.split('.').reduce((obj,key)=>obj?.[key],config);}
  function fieldSet(path,value) {const keys=path.split('.');let obj=config;for(const key of keys.slice(0,-1))obj=obj[key];obj[keys.at(-1)]=value;}
  function showTab(tab) {
    $$('.panel').forEach(el=>el.hidden=el.id!==`panel-${tab}`);
    $$('.tabs button').forEach(el=>{el.classList.toggle('active',el.dataset.tab===tab);el.setAttribute('aria-current',el.dataset.tab===tab?'step':'false');});
    if(window.innerWidth<760) $('.tabs').scrollIntoView({behavior:'smooth',block:'start'});
  }
  $$('[data-tab]').forEach(el=>el.addEventListener('click',()=>showTab(el.dataset.tab)));
  function populate() {
    $$('[data-field]').forEach(el=>{const value=fieldGet(el.dataset.field);if(el.type==='checkbox')el.checked=!!value;else el.value=value??'';});
    $$('[name="lam-mode"]').forEach(el=>el.checked=el.value===config.lamination.mode);
    renderLayerInputs();refresh();
  }
  $$('[data-field]').forEach(el=>el.addEventListener(el.tagName==='SELECT'||el.type==='checkbox'?'change':'input',()=>{
    const nullable=['orderQuantity','lamination.rate','lamination.passes','bagging.rate','weight.areaM2','printing.rate','printing.tierRatePerRoll'];
    const value=el.type==='checkbox'?el.checked:el.type==='number'?(el.value===''?(nullable.includes(el.dataset.field)?null:NaN):Number(el.value)):el.value;
    fieldSet(el.dataset.field,value);refresh();
  }));
  $$('[name="lam-mode"]').forEach(el=>el.addEventListener('change',()=>{config.lamination.mode=el.value;refresh();}));
  $('#add-layer').addEventListener('click',()=>{if(config.layers.length>=50)return toast('当前最多支持50层，请核对结构。');config.layers.splice(config.layers.length-1,0,{material:'PET',thicknessUm:12,density:1.4,pricePerKg:10,actualKg:null});renderLayerInputs();refresh();toast('已添加PET中层，单价10元/kg为演示值，请修改。');});
  function renderLayerInputs() {
    $('#layer-inputs').innerHTML=config.layers.map((l,i)=>`<tr data-layer="${i}"><td><small>${i===0?'外膜':i===config.layers.length-1?'内膜 · 膜宽 +5mm':'中膜 '+i}</small><select aria-label="第${i+1}层材质" data-layer-field="material">${E.MATERIALS.map(m=>`<option value="${m.id}" ${l.material===m.id?'selected':''}>${esc(m.name)}</option>`).join('')}${E.MATERIALS.some(m=>m.id===l.material)?'':`<option value="${esc(l.material)}" selected>${esc(l.material)}</option>`}</select></td>${['thicknessUm','density','pricePerKg','actualKg'].map((key,j)=>`<td><input aria-label="第${i+1}层${['厚度','比重','每公斤单价','实际投料'][j]}" data-layer-field="${key}" type="number" min="${key==='pricePerKg'?'0':'0.000001'}" step="any" value="${esc(l[key]??'')}" ${key==='actualKg'?'placeholder="留空 = 理论 ×1.02"':''}>${key==='thicknessUm'?`<small>${n(l.thicknessUm/1000,3)} mm</small>`:key==='actualKg'?'<small>已填 kg 直接计价</small>':''}</td>`).join('')}<td><button class="remove-layer" aria-label="删除第${i+1}层" data-remove-layer="${i}" ${config.layers.length<=2?'disabled':''}>×</button></td></tr>`).join('');
    $$('[data-layer-field]').forEach(el=>el.addEventListener(el.tagName==='SELECT'?'change':'input',()=>{
      const i=Number(el.closest('[data-layer]').dataset.layer),key=el.dataset.layerField;
      config.layers[i][key]=key==='material'?el.value:el.value===''?(key==='actualKg'?null:NaN):Number(el.value);
      if(key==='material'){const m=E.MATERIALS.find(x=>x.id===el.value);if(m)config.layers[i].density=m.density;renderLayerInputs();toast('已更新材质及默认比重，请核对厚度、单价与实际投料kg。');}
      if(key==='thicknessUm')el.nextElementSibling.textContent=n(config.layers[i].thicknessUm/1000,3)+' mm';
      refresh();
    }));
    $$('[data-remove-layer]').forEach(el=>el.addEventListener('click',()=>{config.layers.splice(Number(el.dataset.removeLayer),1);renderLayerInputs();refresh();}));
  }
  const costRows = r => [['分层原膜',r.materialCost,'#4d8770'],['印刷加工',r.printingCost,'#7295a7'],['复合加工',r.laminationCost,'#9eb5a0'],['制袋加工',r.baggingCost,'#b3bd87'],['交付包装',r.packagingCost,'#d3cba7']];
  const printingNames = {none:'无印刷',area:'面积计费',tier:'色数 / 轴数阶梯'};
  const printingBasis = r => r.printing.mode==='none'?'无印刷 · 0 元':r.printing.mode==='area'?`${n(r.printing.areaM2)} ㎡ × ${n(r.printing.rate,4)} 元/㎡`:`${config.printing.colors} 色 · 批次 ${config.rollCount} 轴 · ${n(r.printing.ratePerRoll)} 元/轴 × 本轴 1 轴`;
  const weightSummary = r => r.weight?.available===false?'单袋克重待补充完整展开面积':`理论单袋：原膜 ${n(r.weight.filmGrams,4)} g + 胶水 ${n(r.weight.glueGrams,4)} g = ${n(r.weight.totalGrams,4)} g；总展开面积 ${n(r.weight.areaM2,6)} ㎡/个`;

  function refresh() {
    updateLibraryUI();
    result=E.calculate(config);
    $('#width-label').textContent=config.bagType==='back-seal'?'产品展开总宽（含搭接）':'产品宽度';
    const areaMode=config.lamination.mode==='area';
    $('[data-field="lamination.rate"]').disabled=!areaMode;
    $('[data-field="packaging.certificate"]').disabled=config.packaging.type==='carton';
    $('[data-field="printing.colors"]').disabled=config.printing.mode==='none';
    $('[data-field="printing.rate"]').disabled=config.printing.mode!=='area';
    $('[data-field="printing.tierRatePerRoll"]').disabled=config.printing.mode!=='tier';
    $('#weight-area-note').textContent=config.weight.areaM2!==null?'使用手工录入的单袋总展开面积。':config.bagType==='custom'||config.bagging.standup?'请填写含全部折边、底部与正反面的单袋总展开面积，再计算理论克重。':config.bagType==='back-seal'?'中封袋：总展开宽（含搭接）× 产品长度，只计算一次，不再乘 2。':'平口袋：产品宽度 × 产品长度 × 正反两面。折边、异形或平底结构请手工覆盖总面积。';

    $('#structure').innerHTML=config.layers.map((l,i)=>`<span class="layer-chip">${esc(l.material)} ${esc(l.thicknessUm)}μm</span>${i<config.layers.length-1?'<span class="muted">/</span>':''}`).join('');
    const notes=config.layers.map((l,i)=>{const m=E.MATERIALS.find(x=>x.id===l.material);return `<p>${i+1}. ${esc(m?.name||l.material)}：${esc(m?.note||'自定义材料，请按供应商资料录入比重。')}</p>`;});
    $('#material-notes').innerHTML=notes.join('');
    $('#validation').innerHTML=result.ok?`<details class="validation-box"><summary>${result.warnings.length+1} 项假设 / 待核实 · 查看</summary><ul>${result.warnings.map(x=>`<li>${esc(x)}</li>`).join('')}<li>制袋费默认按预计合格数量计费，实际结算口径请确认。</li></ul></details>`:`<div class="validation-box error"><b>请补全或修正输入</b><ul>${result.errors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`;
    $('#copy-result').disabled=!result.ok;$('#export-json').disabled=!result.ok;$('#export-csv').disabled=!result.ok;
    if(!result.ok){['unit-cost','total-cost','raw-output','good-output','billable-output','quote-good','quote-billable','quote-unsold'].forEach(id=>$('#'+id).textContent='—');['cost-bars','layer-results','weight-results','printing-explain','lamination-explain','bagging-explain','packaging-explain','cost-detail','formulas','layout-preview'].forEach(id=>$('#'+id).innerHTML='<p class="muted">请完成有效输入后查看计算结果。</p>');$('#layout-note').textContent='';return;}
    const r=result;
    const hasWeight=r.weight?.available!==false;
    $('#weight-results').innerHTML=hasWeight?`<div class="weight-totals"><div><span>原膜克重</span><strong>${n(r.weight.filmGrams,4)} <small>g/个</small></strong></div><div><span>估算胶水克重</span><strong>${n(r.weight.glueGrams,4)} <small>g/个</small></strong></div><div class="weight-total"><span>含胶总克重</span><strong>${n(r.weight.totalGrams,4)} <small>g/个</small></strong></div></div><div class="table-wrap"><table><thead><tr><th>材料层</th><th>厚度 μm</th><th>比重 g/cm³</th><th>理论 g/个</th></tr></thead><tbody>${r.weight.layers.map((layer,i)=>`<tr><td>${positionName[r.layers[i].position]} / ${esc(layer.material)}</td><td>${n(r.layers[i].thicknessUm,2)}</td><td>${n(r.layers[i].density,3)}</td><td>${n(layer.grams,4)}</td></tr>`).join('')}</tbody></table></div><p class="muted">单袋总展开面积 ${n(r.weight.areaM2,6)} ㎡；克重不含原膜加宽边料、投料损耗及额外附件。</p>`:'<p class="calc-note">请填写单袋总展开面积，包含所有正反面、底部和折边。当前制造成本仍按本轴投料计算。</p>';
    $('#printing-explain').innerHTML=r.printing.mode==='none'?'本轴不计印刷费。':r.printing.mode==='area'?`印刷面积：${config.filmWidthMm} ÷ 1,000 × 6,000 = <b>${n(r.printing.areaM2)} ㎡</b>。<br>${printingBasis(r)} = <b>${yuan(r.printingCost)}</b>。`:`${printingBasis(r)} = <b>${yuan(r.printingCost)}</b>。<br>${config.printing.tierRatePerRoll===null?'采用历史工厂模板；当前适用性待核实。':'采用人工确认的每轴费率。'}本单按一轴成本核算。`;
    $('#unit-cost').textContent=n(r.unitCost,5);$('#total-cost').textContent=yuan(r.totalCost);
    $('#raw-output').textContent=n(r.rawQuantity,2);$('#good-output').textContent=n(r.qualifiedQuantity,0);$('#billable-output').textContent=n(r.billableQuantity,0);
    $('#quote-good').textContent=n(r.qualifiedQuantity,0)+' 个';$('#quote-billable').textContent=n(r.billableQuantity,0)+' 个';$('#quote-unsold').textContent=n(r.unsoldQuantity,0)+' 个';
    $('#cost-bars').innerHTML=costRows(r).map(([label,cost,color])=>`<div class="cost-item"><div class="cost-row"><span>${label}</span><strong>${yuan(cost)}</strong></div><div class="bar-track"><div class="bar" style="width:${Math.max(0,Math.min(100,cost/r.totalCost*100))||0}%;background:${color}"></div></div></div>`).join('');
    $('#layout-badge').textContent=config.lanes+' 出 / '+n(config.cutLengthMm,0)+' mm切长';
    $('#layout-preview').innerHTML=`<div class="layout-film"><div class="film-title"><span>复合膜宽 ${n(config.filmWidthMm,0)} mm</span><span>走膜方向 ↓</span></div><div class="film-lanes">${Array.from({length:Math.min(config.lanes,8)},(_,i)=>`<div class="bag"><b>${i+1} 出</b></div>`).join('')}${config.lanes>8?'<span>…</span>':''}</div><div class="film-caption">内膜 ${n(config.filmWidthMm+5,0)} mm · 皮轴 ${n(r.lamination.rollerWidthMm,0)} mm · 固定 6,000 m</div></div>`;
    $('#layout-note').textContent=config.bagType==='back-seal'?`中封展开总宽 ${config.widthMm} mm，${config.lanes} 出净展开合计 ${n(config.widthMm*config.lanes,0)} mm。与膜宽差额 ${n(config.filmWidthMm-config.widthMm*config.lanes,0)} mm 的工艺用途需车间确认。${config.widthMm} mm 按完整展开宽录入，已含背封搭接，不再乘2。`:`产量按 6,000 × 1,000 ÷ ${config.cutLengthMm} × ${config.lanes} 核算。产品宽度不会自动改写膜宽；请按车间实际排版录入。`;
    $('#layer-results').innerHTML=`<table><thead><tr><th>层位 / 材料</th><th>理论 g/个</th><th>膜宽 mm</th><th>理论 kg</th><th>建议 kg ×1.02</th><th>采用 kg</th><th>金额 元</th></tr></thead><tbody>${r.layers.map((l,i)=>`<tr><td>${positionName[l.position]} / ${esc(l.material)}</td><td>${hasWeight?n(r.weight.layers[i].grams,4):'待面积'}</td><td>${n(l.widthMm,0)}</td><td>${n(l.theoreticalKg,4)}</td><td>${n(l.suggestedKg,4)}</td><td>${n(l.actualKg,4)}${l.overridden?' *':''}</td><td>${n(l.cost)}</td></tr>`).join('')}</tbody><tfoot><tr><td>合计（原膜）</td><td>${hasWeight?n(r.weight.filmGrams,4):'待面积'}</td><td></td><td>${n(r.totalTheoreticalKg,4)}</td><td></td><td>${n(r.totalActualKg,4)}</td><td>${n(r.materialCost)}</td></tr></tfoot></table><p class="muted">* 为人工确认 kg；总额按未舍入的中间值计算。</p>`;
    $('#lamination-explain').innerHTML=areaMode?`综合计费面积：<b>${n(r.lamination.fullAreaM2)} ㎡/道</b> = ${config.filmWidthMm} ÷ 1,000 × 6,000。<br>采用 ${n(r.lamination.rate,3)} 元/㎡ × ${r.lamination.passes} 道 = <b>${yuan(r.laminationCost)}</b>。已含胶水人工水电。<br>胶量面积 ${n(r.lamination.glueAreaM2)} ㎡/道，使用另一口径，不另计费。`:`皮轴宽：<b>${n(r.lamination.rollerWidthMm,0)} mm</b> = ${config.filmWidthMm} − 10，胶量面积 <b>${n(r.lamination.glueAreaM2)} ㎡/道</b>。<br>胶水 ${n(r.lamination.glueKgPerPass,4)} kg/道 × 20.5 元/kg + 200 元/道 = ${yuan(r.lamination.costPerPass)}。<br>共 ${r.lamination.passes} 道，细算复合费 <b>${yuan(r.laminationCost)}</b>；不加综合平米费。`;
    $('#bagging-explain').innerHTML=`${r.bagging.manual?'人工基础单价':'模板基础单价'} ${n(r.bagging.baseRate,4)} + 已选附加 ${n(r.bagging.addition,4)} = <b>${n(r.bagging.rate,4)} 元/个</b>。<br>${basisName[config.bagging.basis]} ${n(r.bagging.quantity,0)} 个 × ${n(r.bagging.rate,4)} = <b>${yuan(r.baggingCost)}</b>。${r.bagging.template?'<br>匹配说明：'+esc(r.bagging.template.note):''}`;
    $('#packaging-explain').innerHTML=`${config.packaging.type==='carton'?'纸箱4.10 + 套箱袋0.34 + 合格证0.10':'口袋1.56'+(config.packaging.certificate?' + 合格证0.10':'')} = <b>${n(r.packagingUnitCost)} 元/件</b>。<br>⌈${n(r.billableQuantity,0)} ÷ ${n(config.packaging.capacity,0)}⌉ = ${n(r.packagingCount,0)} 件；包装费 <b>${yuan(r.packagingCost)}</b>。`;
    $('#cost-detail').innerHTML=`<div class="table-wrap"><table><thead><tr><th>项目</th><th>计价依据</th><th>成本 元</th><th>分摊 元/个</th></tr></thead><tbody>${costRows(r).map(([label,cost],i)=>`<tr><td>${label}</td><td>${[`${r.layers.length}层 · ${n(r.totalActualKg,4)} kg`,printingBasis(r),`${r.lamination.passes}道 · ${areaMode?'综合平米':'胶水人工'}`,`${n(r.bagging.quantity,0)}个 × ${n(r.bagging.rate,4)}`,`${r.packagingCount}件 × ${n(r.packagingUnitCost)}`][i]}</td><td>${n(cost)}</td><td>${n(cost/r.billableQuantity,5)}</td></tr>`).join('')}</tbody></table></div><div class="detail-totals"><span>总成本 ${yuan(r.totalCost)}</span><b>${n(r.billableQuantity,0)} 个 × ¥${n(r.unitCost,5)}</b></div><p class="muted">显示单价为四舍五入，乘回数量可能与全精度总额有尾差。不可结算超产 ${n(r.unsoldQuantity,0)} 个，成本已由本单承担。</p>`;
    const liveFormulas=[...r.layers.map(l=>`${positionName[l.position]} ${l.material}：${l.widthMm} × 6000 × (${l.thicknessUm} ÷ 1000) × ${l.density} ÷ 1000 = ${n(l.theoreticalKg,6)} kg；采用 ${n(l.actualKg,6)} kg × ${l.pricePerKg} = ${n(l.cost,6)} 元`),`本单：(${n(r.materialCost,6)} + ${n(r.printingCost,6)} + ${n(r.laminationCost,6)} + ${n(r.baggingCost,6)} + ${n(r.packagingCost,6)}) ÷ ${r.billableQuantity} = ${n(r.unitCost,8)} 元/个`,...r.formulas];
    $('#formulas').innerHTML=liveFormulas.map((s,i)=>`<div class="formula-row"><strong>${String(i+1).padStart(2,'0')}</strong><code>${esc(s)}</code></div>`).join('');
    updateRollerCheck();
  }
  function updateRollerCheck(){const v=Number($('#roller-reference').value);$('#roller-check').textContent=!v?'':`参考 ${v} mm；本单皮轴 ${n(config.filmWidthMm-10,0)} mm。${v===config.filmWidthMm-10?'规格相符，仍需确认库存。':'规格不同，请车间核实。'}`;}
  $('#roller-reference').addEventListener('change',updateRollerCheck);
  function snapshot(){return {schema:'PackPilot.quote.v2',exportedAt:new Date().toISOString(),config,result};}
  function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('已生成下载文件。');}
  function filename(ext){return 'PackPilot-'+String(config.name||'核价单').replace(/[\\/:*?"<>|\r\n]/g,'_').slice(0,70)+'.'+ext;}
  $('#export-json').addEventListener('click',()=>{if(result.ok)download(JSON.stringify(snapshot(),null,2),filename('json'),'application/json;charset=utf-8');});
  $('#export-csv').addEventListener('click',()=>{
    if(!result.ok)return;const r=result;
    const rows=[['PackPilot 复合袋核价2.0',config.name],['核价时间',new Date().toISOString()],['规格(mm)',`${config.widthMm}×${config.heightMm}`],['袋型',names[config.bagType]],['切长mm',config.cutLengthMm],['膜宽mm',config.filmWidthMm],['排版出数',config.lanes],['轴长m',6000],['损耗率%',config.lossPct],['单袋总展开面积m2',r.weight.areaM2],['原膜单袋克重g',r.weight.filmGrams],['胶水估算单袋克重g',r.weight.glueGrams],['含胶总克重g',r.weight.totalGrams],[],['层位','材质','厚度um','比重g/cm3','膜宽mm','理论kg','建议kg','实际kg','元/kg','成本元','理论单袋克重g'],...r.layers.map((l,i)=>[positionName[l.position],l.material,l.thicknessUm,l.density,l.widthMm,l.theoreticalKg,l.suggestedKg,l.actualKg,l.pricePerKg,l.cost,r.weight.layers?.[i]?.grams]),[],['印刷模式',printingNames[r.printing.mode]],['印刷色数',config.printing.colors],['计价批次轴数',config.rollCount],['印刷面积m2',r.printing.areaM2],['印刷费率元/m2',r.printing.rate],['印刷阶梯元/轴',r.printing.ratePerRoll],['印刷费',r.printingCost],[],['复合模式',config.lamination.mode],['复合工艺',config.lamination.process],['复合道数',r.lamination.passes],['综合费率元/m2',r.lamination.rate],['综合面积m2/道',r.lamination.fullAreaM2],['皮轴mm',r.lamination.rollerWidthMm],['胶量面积m2/道',r.lamination.glueAreaM2],['胶水标准g/m2',1.5],['胶水kg/道',r.lamination.glueKgPerPass],['胶水元/kg',20.5],['胶水成本元/道',r.lamination.glueCostPerPass],['人工水电元/道',200],['采用单道复合费',r.lamination.costPerPass],['说明','综合与细算互斥：未选模式的参考参数不计入总额'],['制袋费计费基数',basisName[config.bagging.basis]],['制袋基础单价',r.bagging.baseRate],['制袋附加单价',r.bagging.addition],['制袋采用费率',r.bagging.rate],['制袋计费数量',r.bagging.quantity],['包装方式',config.packaging.type],['包装容量',config.packaging.capacity],['包装件数',r.packagingCount],['包装单件费',r.packagingUnitCost],['理论产量',r.rawQuantity],['理论整袋',r.theoreticalQuantity],['预计合格',r.qualifiedQuantity],['可结算',r.billableQuantity],['不可结算超产',r.unsoldQuantity],[],['成本项目','人民币元'],...costRows(r).map(([label,cost])=>[label,cost]),['总成本',r.totalCost],['单袋成本',r.unitCost],[],['公式'],...r.formulas.map(x=>[x]),[],['假设/待核实'],...r.warnings.map(x=>[x])];
    const cell=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    download('\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n'),filename('csv'),'text/csv;charset=utf-8');
  });
  function summary(){const r=result;return `正浩包装 / PackPilot 复合袋报价2.0\n${config.name}\n${names[config.bagType]} ${config.widthMm}×${config.heightMm}mm；${config.lanes}出，切长${config.cutLengthMm}mm，膜宽${config.filmWidthMm}mm\n固定6000m；制袋损耗${config.lossPct}%；预计合格${r.qualifiedQuantity}个，可结算${r.billableQuantity}个，不可结算超产${r.unsoldQuantity}个\n${weightSummary(r)}\n${r.layers.map((l,i)=>`${positionName[l.position]} ${l.material} ${l.thicknessUm}μm，比重${l.density}，单袋${r.weight.available===false?'克重待核':n(r.weight.layers[i].grams,4)+'g'}，膜宽${l.widthMm}mm，理论${n(l.theoreticalKg,4)}kg，采用${n(l.actualKg,4)}kg × ${l.pricePerKg}元/kg = ${n(l.cost)}元`).join('\n')}\n${costRows(r).map(([label,cost])=>label+'：'+n(cost)+'元').join('\n')}\n印刷：${printingNames[r.printing.mode]}；${printingBasis(r)} = ${n(r.printingCost)}元\n复合：${config.lamination.mode==='area'?'综合面积'+r.lamination.fullAreaM2+'㎡/道 × '+r.lamination.rate+'元/㎡':'皮轴'+r.lamination.rollerWidthMm+'mm；胶量面积'+r.lamination.glueAreaM2+'㎡/道；胶水'+n(r.lamination.glueKgPerPass,4)+'kg × 20.5元/kg + 200元人工水电 = '+n(r.lamination.costPerPass,4)+'元/道'} × ${r.lamination.passes}道\n制袋费基数：${basisName[config.bagging.basis]}，${r.bagging.quantity}个 × ${r.bagging.rate}元/个\n包装：${r.packagingCount}件 × ${r.packagingUnitCost}元/件\n总成本：${n(r.totalCost)}元\n单价：${n(r.unitCost,5)}元/个（总成本/可结算数，无利润，不乘1.07）\n假设与待核实：${r.warnings.join('；')}；制袋费默认按合格数计费。`;}
  $('#copy-result').addEventListener('click',async()=>{if(!result.ok)return;const s=summary();try{await navigator.clipboard.writeText(s);toast('已复制完整核价结果与待核实说明。');}catch{const text=document.createElement('textarea');text.value=s;text.style.position='fixed';text.style.top='0';document.body.append(text);text.select();const copied=document.execCommand('copy');text.remove();if(copied)toast('已复制核价结果。');else download(s,filename('txt'),'text/plain;charset=utf-8');}});
  $('#save-draft').addEventListener('click',()=>{try{localStorage.setItem(storageKey,JSON.stringify(config));$('#save-status').textContent='草稿已保存在当前浏览器';toast('已保存当前草稿。');}catch{toast('当前浏览器无法保存，请下载JSON留档。');}});
  async function useImported(value){const c=E.normalizeConfig(value.config||value);if(!Array.isArray(c.layers)||c.layers.length>50)throw Error('材料层数必须在2～50层。');const errors=E.validate(c);if(errors.length)throw Error(errors.slice(0,3).join(' '));if(!await leaveCurrent())return false;config=JSON.parse(JSON.stringify(c));activeId=null;savedSignature=null;rememberSelection();populate();return true;}
  $('#load-draft').addEventListener('click',()=>runLibraryAction(async()=>{const raw=localStorage.getItem(storageKey);if(!raw)return toast('当前浏览器还没有草稿。');if(await useImported(JSON.parse(raw)))toast('已恢复草稿，使用“复制为新规格”存入规格库。');}));
  $('#import-button').addEventListener('click',()=>$('#import-file').click());
  $('#import-file').addEventListener('change',async event=>{const file=event.target.files[0];if(!file)return;try{if(file.size>1e6)throw Error('文件不能超过1MB。');await runLibraryAction(async()=>{if(await useImported(JSON.parse(await file.text())))toast('数据已导入并重新核价，使用“复制为新规格”保存。');});}catch(e){toast('导入失败：'+e.message);}finally{event.target.value='';}});
  const sources=[['PET · 1.40','TOYOBO典型薄膜数据；供应商实际值优先。','https://www.toyobo-global.com/products/ind_film/method/index.html'],['PA/BOPA · 假设1.15','Biaxis BOPA 15E：1.15±0.01。1.16仅为可选假设，请核实厂家。','https://www.biaxis.com/uploads/tds-bopa-15e-std.pdf'],['LDPE · 0.923','SABIC HP4025ZN树脂牌号示例，成膜共混配方需另核实。','https://www.sabic.com/en/products/polymers/polyethylene-pe/sabic-ldpe'],['LLDPE · 0.918','Shell 18F5M树脂牌号示例，不代表所有LLDPE配方。','https://www.shell.us/business/sectors/shell-polymers/product-selector/18f5m.html'],['HDPE / 低压PE · 0.952','SABIC F00952示例；不使用原工厂表中的0.90作为通用物性。','https://www.sabic.com/en/products/polymers/polyethylene-pe/sabic-hdpe'],['RCPP · 0.91','Sinofilm蒸煮级CPP典型数据。','https://www.sino-film.com/pdf/RCPP.pdf'],['VMPET · 1.40','按PET基膜估算，未单列镀铝增重；Toray 12μm克重16.8g/㎡可作参考。','https://www.torayfilms.eu/wp-content/uploads/2019/12/Claryl%C2%AE-M-M-O.pdf']];
  $('#density-sources').innerHTML=sources.map(([name,note,url])=>`<div class="source-row"><b>${name}</b><br>${note} <a href="${url}" target="_blank" rel="noopener">厂家资料 ↗</a></div>`).join('')+'<div class="source-row"><b>PE历史单 · 0.93</b><br>仅为当前历史订单假设，无该批次厂家TDS。全部密度、单价及投料kg均允许修改。核验日期：2026-11-06。</div>';
  $('#factory-templates').innerHTML=`<div class="table-wrap"><table><thead><tr><th>制袋型式</th><th>联数</th><th>产品长度</th><th>元/个</th></tr></thead><tbody>${E.BAG_TEMPLATES.map(t=>`<tr><td>${names[t.bagType]}</td><td>${t.lanes||'按模板'}</td><td>${t.minExclusiveMm?'>'+t.minExclusiveMm+' 且 ':''}≤ ${t.maxMm} mm</td><td>${n(t.rate,3)}</td></tr>`).join('')}</tbody></table></div><p class="muted">原文多个“以下”范围重叠，暂按最小长度上限优先。背封超过300mm参考同联三边封，未覆盖时必须手填。自立 +0.01、拉链 +0.01 元/个，适用和叠加口径待核实。</p><div class="table-wrap"><table><thead><tr><th>复合工艺</th><th>条件</th><th>元/㎡/道</th></tr></thead><tbody>${E.LAMINATION_TEMPLATES.map(t=>`<tr><td>${t.name}</td><td>${t.id==='solventless'?'少于5轴 0.11；多于5轴 0.10；恰好5轴待核实':'按模板'}</td><td>${n(t.rate,2)}</td></tr>`).join('')}</tbody></table></div><p class="muted">5轴暂按0.11估算，可在综合费栏手动覆盖。多层默认层数减一道，每道6000m，具体设备工艺与收费是否按道需工厂确认。</p>`;
  // Standalone files have no legacy host route; use the sibling V1 page in the complete project.
  if(location.protocol==='file:'||!location.pathname.includes('/v2'))$('#legacy-link').hidden=true;
  populate();
  initializeLibrary();
})();
