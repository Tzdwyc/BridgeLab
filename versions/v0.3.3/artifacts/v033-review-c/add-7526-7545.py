import json
from pathlib import Path
p=Path(__file__).with_name('explicit-7526-7545.json');d=json.loads(p.with_name('explicit-7486-7525.json').read_text(encoding='utf-8'))
d['reasons'].update({
'twoMajors':['ok','ok','对低花开叫的Michaels人工扣叫，自己两门高花至少五张，角色与长度说明准确。'],
'chooseMajor':['ok','ok','同伴Michaels两高花后自己选较可用的S，弱牌也必须选择，说明不保证高实力。'],
'u7528m':['ok','uncertain','Michaels双高花与伙伴2S选择之后，本手有六S六H强赢墩直接4S合理；提示 generic 未约定支持张数虽未虚构八将，但遗漏自己的Michaels五张S承诺，具体应选套角色宜更清晰。'],
'u7534adv':['uncertain','uncertain','同伴Michaels显示两门高花，自己各三张本可选3H/3S八将；自选五张T高D相对不利。此三阶第三套应叫卡未约定，不能直接按自然争叫后的8+五张NF解释确定正确。'],
'e7534m':['ok','error','敌方Michaels并非本方GF，自己五C加初开至少三C确认八将，8点加H单/双S约12支持点，3C可邀请；提示仍有进局逼叫虚构义务，重复7482。'],
'e7534':['error','ok','自己12点均型、四C对邀请3C五C仅九将，约14支持点加邀请最低10只有24，远不足29低花局线；没有真实GF义务，5C被前面虚假GF驱动，宜Pass或竞争4C。5C自然成局固定含义准确。'],
'e7535':['error','ok','同伴强2C人工不承诺C，自己仅三C、4点未确认配合，不能跳5C选择低花局；可2D等待等约定应叫。此5C未约定的提示本身没有硬造真实C套，错在叫品选择。'],
'u7537new':['ok','uncertain','未Pass应叫人在最低NT后自五C以2C改善部分定约合理；卡未定义此具体新低花为人工或自然F1，提示未约定可保留，不能凭真实牌临时改固定约定。'],
'u7537pass':['uncertain','error','此前1S的F1已经由1NT回答，2C提示又明确未约定且不能仅凭新套认F1，但Pass提示仍禁用、称违逼叫，两说明相互矛盾；若要定义该2C自然F1须先补公开卡，叫品边界保留。'],
'u7544':['uncertain','ok','自己15点五D五C非均型，在伙伴自然1H后敌1S可2C描述第二套而不宜轻易停；普通F1遇再次自然干扰的Pass义务卡未精确定义，公开最低15+6仍不保证局，保留边界。']})
d['labels']={
7526:['po','open','p','limit','p','accept','p','pa','p'],
7527:['open','p','one','p','ntminimum','p','ntgame','p','pa','p'],
7528:['open','twoMajors','p','chooseMajor','longrepeat','u7528m','p','pa','p'],
7529:['open','p','u7368','p','pa','p'],
7530:['po','open','p','e7478m','p','pa','p'],
7531:['po','po','po','po'],
7532:['ntopen','p','stayman','p','answerS','p','ntinv','p','pa','p'],
7533:['open','p','ntpart','p','pa','p'],
7534:['po','po','open','twoMajors','e7534m','u7534adv','e7534','p','pa','p'],
7535:['po','po','strongC','leadC','e7535','p','pa','p'],
7536:['po','open','ocnt','p','transfer','p','accepttransfer','p','ntgame','p','pa','p'],
7537:['po','open','p','one','p','ntminimum','p','u7537new','p','u7537pass','p'],
7538:['po','po','po','ntopen','p','pa','p'],
7539:['po','po','open','p','passnew','p','support','p','accept','p','pa','p'],
7540:['weak','p','weakraise','p','pa','p'],
7541:['po','open','x','support','p','pa','freeTech','support','p','pa','p'],
7542:['po','open','p','semi','p','secondsemi','p','pa','p'],
7543:['po','po','ntopen','ocNTu','p','pa','p'],
7544:['open','p','one','oc1','u7544','pa','p'],
7545:['po','po','open','oc2','support','support','accept','p','pa','p']}
p.write_text(json.dumps(d,ensure_ascii=False,indent=2),encoding='utf-8')
