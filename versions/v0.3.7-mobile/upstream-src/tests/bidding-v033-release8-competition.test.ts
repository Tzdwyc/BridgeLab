import { describe,expect,it } from 'vitest';
import { chooseBid,describeCall } from '../src/ai/bidding';
import { chooseCompetitiveCall } from '../src/ai/competition';
import { applyCall,newGame } from '../src/core/game';
import { observe,type BiddingObservation } from '../src/ai/observation';
import { PASS,type Call,type Card,type Suit,type Strain } from '../src/core/types';
const bid=(level:number,strain:Strain):Call=>({kind:'bid',level,strain});
function position(sequence:string,holding:string):BiddingObservation {
  let game=newGame(1,'release8-competition');
  for(const token of sequence.split(' ').filter(Boolean))game=applyCall(game,game.turn,token==='P'?PASS:token==='X'?{kind:'double'}:bid(Number(token[0]),token.slice(1)as Strain));
  const obs=observe(game)as BiddingObservation;
  obs.hand=holding.split('.').flatMap((cards,index)=>cards==='-'?[]:[...cards].map(rank=>({id:`${index}${rank}`,suit:(['S','H','D','C']as Suit[])[index],rank:'23456789TJQKA'.indexOf(rank)+2}as Card)));
  expect(obs.hand).toHaveLength(13);return obs;
}
describe('release8 common competition source and force boundaries',()=>{
  it.each(['P 2H','P 2H P 3H P P'])('uses a perfect twelve-point void takeout over direct or supported preempt: %s',prefix=>{
    const obs=position(prefix,'Q6542.-.AJT6.KQ63');
    expect(chooseCompetitiveCall(obs,'sayc')).toEqual({kind:'double'});
    expect(chooseBid(obs,'sayc')).toEqual({kind:'double'});
  });
  it('allows the same twelve-point compensation for a singleton with all three unbid suits four-plus',()=>{
    expect(chooseCompetitiveCall(position('P 2H','Q654.2.AJT6.KQ63'),'sayc')).toEqual({kind:'double'});
  });
  it('does not lower every twelve-point preempt double or count void as raw HCP',()=>{
    expect(chooseCompetitiveCall(position('P 2H','Q654.32.AJT.KQ63'),'sayc')).toEqual(PASS);
    expect(chooseCompetitiveCall(position('P 2H','Q6542.-.AJT6.KJ63'),'sayc')).toEqual(PASS);
  });
  it.each([['2D',2],['2D P 3D P P',3]])('shows a real honor-rich six-card major over the preempt: %s',(prefix,level)=>{
    const obs=position(prefix as string,'KQJ764.AJT642.7.-');
    expect(chooseCompetitiveCall(obs,'sayc')).toEqual(bid(level as number,'S'));
    expect(chooseBid(obs,'sayc')).toEqual(bid(level as number,'S'));
  });
  it('keeps weak one-honor six-card suits below the constructive source threshold',()=>{
    expect(chooseCompetitiveCall(position('2D','Q97654.JT8652.K.-'),'sayc')).toEqual(PASS);
  });
  it('repeats a good original long minor after a poor-fit response and enemy intervention',()=>{
    const obs=position('1C P 1H 2D','AKT.9.32.KQJ9764');
    expect(chooseCompetitiveCall(obs,'sayc')).toEqual(bid(3,'C'));
    expect(chooseBid(obs,'sayc')).toEqual(bid(3,'C'));
    expect(describeCall(obs.auction,obs.seat,bid(3,'C'),'sayc')).not.toContain('16–18');
  });
  it('does not mistake a weak six-card original suit for a good long playing source',()=>{
    expect(chooseCompetitiveCall(position('1C P 1H 2D','AKT.9.KJ3.Q98764'),'sayc')).toBeUndefined();
  });
  it('shows stopped eleven-point NT invitation instead of a zero-floor three-card major reply',()=>{
    const obs=position('1C X P','A7.T87.K6.KJ8752');
    expect(chooseCompetitiveCall(obs,'sayc')).toEqual(bid(2,'NT'));
    expect(chooseBid(obs,'sayc')).toEqual(bid(2,'NT'));
    expect(describeCall(obs.auction,obs.seat,bid(2,'NT'),'sayc')).toContain('11–12 HCP');
    expect(chooseBid(position('1C X P 2NT P','853.AK62.AJ32.QT'),'sayc')).toEqual(bid(3,'NT'));
    expect(chooseBid(position('1C X P 2NT P','852.AK62.AJ32.98'),'sayc')).toEqual(PASS);
  });
  it('retains lower NT bands and genuinely forced weak major fallback',()=>{
    expect(chooseCompetitiveCall(position('1C X P','A7.T87.K6.KT8752'),'sayc')).toEqual(bid(1,'NT'));
    expect(chooseCompetitiveCall(position('1C X P','T7.T87.K6.QT8752'),'sayc')).toEqual(bid(1,'H'));
  });
  it.each(['7.KJ854.Q963.J42','A.KJ854.KQ63.QJ2'])('does not force a free advancer into unsupported five hearts after enemy four spades: %s',holding=>{
    const obs=position('1C X 4S',holding);
    expect(chooseCompetitiveCall(obs,'sayc')).toEqual(PASS);
    expect(chooseBid(obs,'sayc')).toEqual(PASS);
  });
  it('uses a safe first constructive support cue for advancer\'s natural new major',()=>{
    const obs=position('1D 1S P 2H P','KQJ72.J653.-.JT43');
    expect(chooseCompetitiveCall(obs,'sayc')).toEqual(bid(3,'D'));
    expect(chooseBid(obs,'sayc')).toEqual(bid(3,'D'));
  });
  it('retains a blocking raise rather than treating a weak jump overcall as an ordinary overcall',()=>{
    const obs=position('P P 1C 2D P','QT7.AJT62.K65.98');
    expect(chooseBid(obs,'sayc')).toEqual(bid(3,'D'));
  });
  it('first shows a real five-card major with raw invitation strength after takeout',()=>{
    const obs=position('P 1D X P','JT987.T43.A2.AJ4');
    expect(chooseCompetitiveCall(obs,'sayc')).toEqual(bid(2,'S'));
    expect(chooseBid(obs,'sayc')).toEqual(bid(2,'S'));
    expect(describeCall(obs.auction,obs.seat,bid(2,'S'),'sayc')).toContain('9–11 HCP');
    expect(chooseBid(position('P 1D X P','JT987.T43.A2.K54'),'sayc')).toEqual(bid(1,'NT'));
  });
  it('chooses equal-length unusual suits using visible quality and keeps longer minor choices',()=>{
    expect(chooseBid(position('P P 1C 2NT P','AJ873.KT5.652.T5'),'sayc')).toEqual(bid(3,'H'));
    expect(chooseBid(position('P P 1C 2NT P','AJ873.765.AQJ.54'),'sayc')).toEqual(bid(3,'D'));
    expect(chooseBid(position('P P 1C 2NT P','AJ87.KT5.7652.54'),'sayc')).toEqual(bid(3,'D'));
  });
  it('can extend a weak jump overcall after an enemy negative double without treating it as penalty',()=>{
    const obs=position('P 1D 2S X','975.Q8753.3.A987');
    expect(chooseCompetitiveCall(obs,'sayc')).toEqual(bid(3,'S'));
    expect(chooseBid(obs,'sayc')).toEqual(bid(3,'S'));
    expect(chooseBid(position('P 1D 2S X','97.Q8753.3.A9876'),'sayc')).toEqual(PASS);
  });
  it('bounds low-HCP natural response compensation to a genuine eight-card honor-rich source',()=>{
    expect(chooseBid(position('P 1H 2D','AQJT8762.-.Q8.T32'),'sayc')).toEqual(bid(2,'S'));
    for(const hand of ['AQJT8762.-.J8.T32','AQJT876.-.Q83.T32','AJT98762.-.K8.J32']) {
      expect(chooseCompetitiveCall(position('P 1H 2D',hand),'sayc')).not.toEqual(bid(2,'S'));
      expect(chooseBid(position('P 1H 2D',hand),'sayc')).not.toEqual(bid(2,'S'));
    }
  });
  it('bounds an exceptionally long preempt-defense source by raw strength, length and top honors',()=>{
    expect(chooseBid(position('2S','9.2.AQJT987652.J'),'sayc')).toEqual(bid(3,'D'));
    expect(chooseBid(position('2S','9.2.KQJT9876.J32'),'sayc')).toEqual(bid(3,'D'));
    for(const hand of ['9.42.AQJT987.J32','9.A.QJ987652.J32','9.2.KQJT9876.932']) {
      expect(chooseCompetitiveCall(position('2S',hand),'sayc')).not.toEqual(bid(3,'D'));
      expect(chooseBid(position('2S',hand),'sayc')).not.toEqual(bid(3,'D'));
    }
  });
  it('does not export the low-HCP three-minor exception to an unagreed three-major or four-minor call',()=>{
    const major=position('2S','9.KQJT9876.2.J32');
    const fourthLevel=position('3S','9.2.AQJT987652.J');
    expect(chooseCompetitiveCall(major,'sayc')).not.toEqual(bid(3,'H'));
    expect(chooseBid(major,'sayc')).not.toEqual(bid(3,'H'));
    expect(chooseCompetitiveCall(fourthLevel,'sayc')).not.toEqual(bid(4,'D'));
    expect(chooseBid(fourthLevel,'sayc')).not.toEqual(bid(4,'D'));
  });
});
