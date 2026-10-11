import json
from pathlib import Path
root = Path(__file__).resolve().parent
source = json.loads((root / 'v033-findings-replay-observations.json').read_text(encoding='utf-8'))
sha = '9abe5438b78077a9393e00434fbb6f3f493543885920bec9f72ae409785f3363'
assert source['sourceSha256'] == sha
# Every verdict below was written by GPT after reading each hand and public prefix.
# This script only attaches source fields and serializes those explicit judgments.
judgments = '''
180|ok|ok|10点六H可自然争叫；首次二阶角色与长度已补。
181|ok|ok|四C是第二套，答第四花色时重复仍只承诺四张。
182|ok|ok|自己的D有AKQ止张及长源，可选择3NT而不虚造C配合。
183|error|ok|15点六C及S单张，竞争后至少可2C描述；同伴已Pass的1H只公开四张，不能强算三H支持八将。
184|error|ok|8点四S对自然五S确认九将及C单张，至少2S竞争，Pass遗漏支持。
185|ok|ok|12点五S QJ及旁门实力，二阶首次自然竞争可行。
186|error|ok|五C仅JT986，三阶对阻击争叫套质不足；13HCP不能代替强长套。
187|error|ok|15点对开叫人公开12+，不能直接放过弱跳2H，应强扣或其他进局探索。
188|ok|error|转移后五S五H展示3H正确；此自然第二高花是成局逼叫，说明不能称不自动建立逼叫。
189|ok|ok|12点五H及双低花荣誉可防守1NT；首次自然说明修正。
190|error|ok|9点三H对五H已八将，应3H简单支持二阶争叫，不能遗漏回应。
191|ok|ok|18点四S支持及两个旁门双张，能接受3S竞争邀请到4S。
192|ok|ok|11点三H面对16+六H邀请，公开强度足够4H。
193|ok|ok|12点五D AQ可自然二阶争叫，首叫角色正确。
194|error|ok|六S非均型且敌2D仍留2S，应竞争回主套而非自动Pass。
195|ok|ok|14点五S QJ及四H可以首次自然二阶争叫。
196|error|ok|12点五H仅J高，三阶对弱二争叫缺套质，原问题尚存。
197|ok|ok|八点四S和H双张对Stayman四S，可作偏轻3S邀请。
198|ok|ok|公开前缀中W没有先Pass；1H自然6+逼叫一轮说明正确，旧审阅误认过手。
199|ok|ok|16点四S加已知九将及H双张，接受转移后NT邀请选4S合理。
200|error|ok|8点三H AQ对首次自然五H已八将，应2H回应。
201|ok|error|自然强2NT再叫已经解除技术X应答，2点可Pass；禁止Pass的人工状态提示仍错误。
202|ok|ok|12点五D AT可二阶自然竞争，说明改为首次争叫正确。
203|ok|ok|15HCP四S及D单张有18支持点，负加倍后3S强邀请说明匹配。
204|error|ok|七点四S加H单张达十支持点，面对16+邀请应4S，不能rawHCP拒邀。
205|error|ok|开叫人H缺门且六D，不能接受过手2H坏配合；可描述3D或回五S。
206|ok|error|平衡位原技术X下限是9+，不是固定12+；回答cue的五S叫品本身正确。
207|ok|ok|六H AKT及11点首次自然2H合理，未借敌方隐藏牌。
208|ok|ok|13点五D AJ及H单张，平衡自然2D可行，角色已明确。
209|ok|error|六H十一点跳3H邀请正确；说明只有六张且未写10–12邀请分档，仍遗漏关键强度。
210|ok|ok|强2C遭首攻X仍等待2D，人工而非自然D长度。
211|ok|ok|4点加22–24最低26，用3C探索四H局正确。
212|ok|ok|四S四C13点的sandwich X要求未叫花色，技术角色正确。
213|uncertain|ok|首次技术X后可重申或Pass等待，13点再争不硬判唯一；新Pass未伪标惩罚。
214|ok|ok|旧前缀重复技术X后的四C最低3C可行，不能当自由六点新套。
215|error|ok|11点三S及H双张有12支持点，XX逃叫后最低2S仍低报邀请。
216|ok|ok|10点六C QT可平衡二阶自然竞争，说明正确区分直接位。
217|uncertain|ok|四D只公开七配，新卡明确四张偏好NF，2D与1NT可取舍，不能硬称五D支持。
218|ok|ok|七点五H QJT平衡1H符合降低实力门槛，角色修正。
219|error|ok|15点三H对平衡五H已八将，至少应邀请或cue，不能漏掉回应。
220|error|ok|6点三S对首次自然五S应2S支持，Pass仍遗漏基本回应。
221|uncertain|ok|九D AKQJ仅13点，2D合法自然首叫；更强长套表达未细分，不硬指定跳叫。
222|error|ok|八点五H与十将及两双张有12支持点，至少应3H邀请，2H低报。
223|error|ok|12点四H对自然四H已八配，敌cue不应让开叫人遗漏2H支持。
224|uncertain|error|11HCP五D两个双张有13支持点，3D可讨论但固定10–12说明不包本手。
225|ok|ok|原第二套四S回答第四花色，仍四张而非六张。
226|error|ok|十点最低二阶五D，3D最低回叫仍合法，4D错误跳示额外实力。
227|error|ok|16点双五低花且S缺门，能2C真实第二套；Pass遗漏明确非均型续叫。
228|error|ok|六点五S对五S十将，至少2S支持，迟发争叫后回应仍遗漏。
229|ok|ok|13点五D继续竞争3D可行，实力X不再误归负X。
230|error|error|Michaels最低八点面对被迫2S不知伙伴实力且未保证五S，4S冒进；提示伙伴五S虚构长度。
231|ok|ok|八点四H加D双张，对16支持点邀请达25，4H正确。
232|error|ok|十二点均型面对16+长C邀请，NT荣誉足，应3NT而非停3C。
233|error|ok|八点五H对四H有九将及两双张，11支持点宜3H邀请。
234|error|error|十八点七D强牌被普通10–16争叫2D低报，需强牌技术X等明确路线。
235|ok|ok|十六点四S对五S九将及C双张调整18，接受到4S合理。
236|error|ok|十八点四D支持对公开五D，九将及C双张足以邀请，不能停2D。
237|error|error|实际12HCP却改叫强NT2NT并写18+，原伪报强新套变成另一种强度伪报。
238|error|ok|八点四H对五H九将有9支持点，16+再邀最低25应4H。
239|ok|ok|十二点六C AKQ首次二阶争叫合理，说明正确。
240|error|ok|八点三S加D双张为9，对16+3S邀请达25，不能Pass。
241|error|ok|十三点四H和C单张16支持点，对3H邀10+已有足局，敌3S后仍应4H。
242|ok|ok|2S低花接力答3C后改3D是六D逃叫NF，人工义务已释放。
243|error|ok|十一点均型对16+跳C邀最低27，宜3NT接受而非停3C。
244|ok|ok|十一点四H加S双张，对开叫强邀请接受4H正确。
245|uncertain|error|八点四H对五H实际九将，2H可弱支持；说明只能弱二三张偏好并断言5–2，漏掉真实支持。
246|ok|error|十一点六S3S邀请正确，说明未写邀请实力分档。
247|error|ok|八点三S加D双张为9，对16+再邀最低25应4S。
248|ok|ok|三S对公开六S九将，4S支持及自己仅需两张的条件说明正确。
249|error|ok|十八点不能接受最低C偏好而隐瞒额外实力，宜2NT邀请等。
250|error|ok|十四点双五低花及S单张，仍可2C描述，Pass漏竞争非均型续叫。
251|ok|ok|六点四H加D单张为9，16+邀请使4H合理。
252|ok|error|十二点有C止可被迫答第四花色2NT；12–21范围已改，用途却仍写邀请而非履行询问。
253|uncertain|ok|十六点五C最低回套长度现诚实；另四S可1S更描述，选套取舍不强判。
254|error|error|十五点在技术X后自由3S却承诺17+五张，叫品与强度仍不符。
255|error|ok|己九点加公开强17+至少26，自己H止及D K，可3NT，不能借搭档隐藏15点拒局。
256|error|uncertain|强2C进局逼叫后仅两S却4S签自然新套仍错误，宜4D或4H；未约定说明无法使错叫可用。
257|error|ok|自己八点对公开强D17+足25且D仅两张，必须继续探局不能接受2D。
258|ok|ok|两S对公开六S八将及14HCP，支持到4S及两张支持条件正确。
259|error|ok|九点五C对三C八配且H单张，有12支持点应3C邀请。
260|ok|ok|十五点六D AKQJT提供长源，对10+邀请足25，3NT合理。
261|error|ok|八点四S对五S九将加D缺门，有13支持点，2S最低支持低报。
262|uncertain|ok|十八点五C竞争4C现不强称六张，继续C与真实四D取舍保留。
263|error|ok|十四点五H五C及Q单D，敌1NT后可2C第二套，Pass仍遗漏非均型竞争。
264|ok|error|两S对六S确认八将，八点加H单张有10支持点，4S接受正确；hover仍称弱部分定约错误。
265|ok|error|十二点两H对公开六H确认八将，S双张加1使25支持点下限，可4H；hover仍称弱部分定约错误。
266|error|ok|七S及D缺门的十五点强手，对NT答叫至少两S可知九将，不能停1NT。
267|error|ok|十八点六S仍只2S最低回套，低报强邀请，宜3S或其他强续叫。
268|ok|ok|十四点五S AK防守1NT可自然争叫，首次角色正确。
269|error|error|十七点七H强手仍普通2H并描述10–16，强牌路线和范围冲突未修。
270|error|ok|十八点五H面对最低两H偏好七将未确认，不能直接Pass隐瞒实力，宜NT邀请。
271|error|ok|十点四D对六D十将，C单张及额外将调整15，加16+达31，应5D。
272|uncertain|error|十七点五D有C AK止可2NT回答第四花色，精确强范围已撤；用途仍误写自愿邀请。
273|uncertain|ok|四C均型未确认八将，1NT更自然；卡现允许四C偏好NF，2C不硬判错误。
274|ok|ok|十四点五D AJ二阶首次自然竞争可行，说明修正。
275|error|ok|九点三H加D双张达10支持点，应3H邀请，2H低报。
276|error|ok|八点四S对五S九将及两双张有11支持点，应3S邀请。
277|ok|ok|十四点四H加S单张17支持点，对10+邀请及八配可4H。
278|error|ok|十八点S缺门及六C AKQJ，3S后仍有明确技术X或4C强竞争，Pass遗漏。
279|error|ok|十点三D对六D九将，H单张及额外将调整13，加16+达29，应5D。
280|error|ok|九点四S对五S九将及两双张为12支持点，应3S邀请。
281|uncertain|ok|九点四C且3C仍合法，4C是真跳邀；套质与只公开七C使叫品保留，不再假称强迫四阶。
282|ok|ok|十六点四S加H单张19支持点，对四S简单支持最低6足25，4S合理。
283|uncertain|ok|无C止以四S第二套答第四花色可讨论，提示四张真实。
284|uncertain|ok|十二点仅两S对四S六将，Pass未违规F1；2NT邀请探索更自然，不能签4S。
285|error|ok|十二点上限且真实五H四C，弱2C偏好仍低报，宜第四花色或NT邀请。
286|error|error|十点只有四C对开叫三C未八将，3C要求五支持的邀请不符合本手。
287|ok|ok|十三点五S KQT首次自然2S可行，角色已改。
288|error|ok|六点四S对五S九将及H双张到8支持点，应3S简单回应。
289|ok|ok|四H Stayman自然回答且已到高花局，四点四H可Pass，没有再抬五阶义务。
290|ok|ok|八点四H及C双张9支持点，对16+邀请4H合理。
291|error|ok|七S KQT自然重复最低2S仍可用，不能因敌2D放弃明显长套。
292|uncertain|ok|14点五C好源且伙伴公开H，可讨论3NT或3D继续GF；未借四D断言八配。
293|ok|ok|普通NT再叫后的2D自然偏好NF，可以Pass，人工状态已修。
294|error|ok|九点五H对五H十将及两双张调整13，应至少3H邀请而非最低2H。
295|error|ok|十一点六S及H缺门，竞争2H后至少2S或3S邀请，Pass丢主套。
296|error|error|仅三S对一盖一四S七配，却2S要求四张支持，原虚造支持尚存。
297|ok|ok|九点六D跳4D为真邀请，最低3D仍合法，强迫四阶说明已改。
298|error|ok|十五点对长H邀请10+最低25，H单张不能停3H，应选择NT或继续描述D。
299|error|ok|十D AQJT极端长套有明确3D竞争价值，完全Pass仍遗漏主体；当前敌2S指称已改。
300|error|ok|十五点七H AKJ及仅两S，宜最低2H回原强长套，不能因新套NF停七张总S。
301|error|error|十一点五D对三D八配加C单张14支持点，应邀请；hover断言未确认八配也不实。
302|ok|ok|十二点五H AQT及双五形状，首次二阶争叫合法，角色说明修正。
303|ok|error|五点四H对五H九将有六支持点可3H竞争；原2H是非跳争叫而非弱跳，hover仍错。
304|ok|ok|八点对迟到18–19NT邀请足26，接受3NT合理。
305|error|ok|十二点D单张且五S四H，不能停坏D配合，宜2H真实第二套或NT邀请。
306|error|ok|十二点五C对四C九将及H单张16支持点，至少3C邀或第四花色，不能Pass。
307|error|ok|八点四S对五S九将加C单张共12支持点，应邀请3S而非最低2S。
308|error|ok|八点对强18+NT最低26，应3NT而非停1NT。
309|error|ok|十四点对一阶争叫最低8仅22，且四S廉价1S可用，直接3NT盲进局。
310|error|ok|七点六C对三C九将及H单张有11支持点，应3C邀而非2C。
311|error|ok|十五点五D四C及两H，2C真实第二套仍可用，Pass漏续叫。
312|uncertain|ok|九点四C只七张，1NT更自然；新卡明示四C偏好NF，不硬判2C本身非法。
313|ok|ok|二十点H单K不宜惩罚；二次X现明确技术角色，可请求选未叫花色。
314|ok|ok|三点四S回答二次技术X最低2S合理，0点也有义务。
315|ok|error|实际五C对开叫三C确认八配，2C可弱支持；hover断言未确认八将仍不实。
316|error|ok|十三点只有敌C A8，不足惩罚2C，防守质量未达，X仍错误。
317|ok|ok|两S对公开六S八配，可接受4S；公开套长与支持要求已修。
318|ok|error|十二点七H KQJT应3H邀请，说明仍缺10–12邀请强度。
319|ok|ok|四H对自然四H的2H是支持，公开条件正确。
320|ok|ok|五点六H被迫最低3H回答技术X，不是自由争叫，说明准确。
321|error|ok|十一点六H及D缺门只有两C，应3H再描述，不能接受六张总C坏配合。
322|ok|ok|十三点加15最低28，Stayman答后选择3NT正确。
323|error|ok|十四点对NT邀至少11已25，应3NT接受，不能Pass。
324|ok|ok|十四点六C AKJ首次二阶争叫可行，角色说明修正。
325|error|error|八点六S自由二阶新套不到10+，叫品与hover10+F1范围冲突未修。
326|uncertain|error|十六点双五且D A止可2NT强迫答第四花色，不能只写邀请用途；原18–19错误范围已撤。
327|ok|error|十点七S AKQT应3S邀请，说明只有六张未给邀请实力分档。
328|error|ok|十六点三H对转移五H加C双张有17支持点，邀请至少8达25，应4H或3NT。
329|uncertain|ok|八点六C AQJ在敵2H后可自由3C，卡未明确三阶自由新套下限；Pass不硬判绝对违规。
330|uncertain|ok|十六点三S對开叫五S八配，4S优先；均型3NT可作局种取舍，不必硬判漏局。
331|error|ok|十四点三H对公开自然1H只有四张但可2H或其他描述，Pass遗漏本方继续竞争；不硬算五H配合。
332|ok|ok|十四点五S KJ可首次自然防守1NT，说明角色正确。
333|error|ok|六点三S对五S八将有简单3S支持，不能Pass二阶自然争叫。
334|error|ok|十一点四S对五S九将加H单张，强支持可cue2D，Pass遗漏实力。
335|ok|ok|十一点五S加C单张及九将有15支持点，对邀请10+最低25，4S接受已修。
336|ok|ok|十点H缺门非定量NT牌，Stayman否高花后3NT实牌选择合理，不虚造D配合。
337|ok|error|实际20HCP而hover固定18–19，叫3NT合理但上限说明仍漏20–21。
338|ok|ok|十二点双五低花H单张，2NT邀可避免原坏配合并表上限，非强迫直接局。
339|error|ok|十三点四H对五H九将有14支持点，cue后最低答仍需邀请3H，不宜Pass。
340|ok|ok|十二点五D KQT二阶防守1NT自然争叫合理，首次角色已补。
341|uncertain|ok|十二点五D配合和H单张可3D邀更描述，2NT非均型邀请的局种取舍保留。
342|error|ok|十点七S KJ及D缺门，最低2S自然争叫可用，Pass遗漏明显长套竞争。
343|error|ok|八点三H加C双张有9支持点，对16+3H邀足25，应4H。
344|ok|error|十一点六H强套3H邀请合理，说明缺10–12邀请强度与长套价值。
345|ok|error|五S五H十四点转移后3H正确；应明确五H及GF，不能称不建立逼叫。
346|error|ok|自己S K和H A有两关键张，15–17NT搭档5D只可能三张，五关键张齐且有Q，应6S不能停5S。
347|error|ok|七点五S对五S十将及H单张，至少2S支持，Pass漏掉极长配合。
348|uncertain|error|七点六D可描述先前负X显示的低花；说明全称未约定并否认自然长套信息不准确，叫品强度边界保留。
349|uncertain|ok|十四点三S对一盖一公开四S未八配，不可借实际五S判必须2S；仍有四H或五C描述取舍。
350|error|ok|十四点对2NT邀请至少11已25，均型应3NT接受而非Pass。
351|error|error|八点六H免费2H低于10+F1门槛，叫品与明确实力说明冲突。
'''
out = []
for line in judgments.strip().splitlines():
    i, call_verdict, meaning_verdict, reason = line.split('|', 3)
    i = int(i)
    row = source['rows'][i]
    out.append({'rowIndex': i, 'board': row['board'], 'step': row['step'], 'seat': row['seat'],
                'newCall': row['newCall'], 'callVerdict': call_verdict, 'meaningVerdict': meaning_verdict,
                'reason': reason, 'sourceSha256': sha, 'reviewer': 'v033-postfix-review-competition'})
assert [r['rowIndex'] for r in out] == list(range(180, 352))
document = {'sourceSha256': sha, 'method': 'GPT personally reviewed each hand and public prefix; explicit authored judgments only, no automatic quality oracle.',
            'reviewedRowRange': [180, 351], 'rows': out,
            'completeAuctionFollowups': [1166,1187,4072,4198,4283,4445,4555,4579]}
(root / 'v033-postfix-review-competition.json').write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Saved {len(out)} explicit GPT judgments bound to {sha}')
