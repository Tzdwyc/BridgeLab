import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
try{
 await page.goto('http://127.0.0.1:5205/#/home');
 await page.getByRole('button',{name:'设置',exact:true}).click();
 const select=page.getByRole('combobox',{name:'叫牌模型',exact:true});
 for(let i=0;i<15&&!await select.count();i++)await page.getByRole('button',{name:'下一页游戏设置',exact:true}).click();
 await select.waitFor();
 const app=page.getByTestId('app');
 const rows=[];
 for(const [profile,sha]of[['original-sl','96cc4c3c993d168657e216b8b3bf3ebb681493b965dd6c908ecdee14d45b375f'],['seed101-epoch08','41556ff0f83ced20eeea66a853b87269f3de0ac62b1aca75abce4bf9a63275e3']]){
  await select.selectOption(profile);
  await page.waitForFunction(expected=>document.querySelector('[data-testid=app]')?.getAttribute('data-sl-loaded-sha')===expected,sha,{timeout:30000});
  rows.push({profile,actualLoadedSHA256:await app.getAttribute('data-sl-loaded-sha')});
 }
 writeFileSync('artifacts/v311-ui/settings-models.json',JSON.stringify({passed:true,rows},null,2));
 console.log(JSON.stringify({passed:true,rows}));
}finally{await browser.close();}
