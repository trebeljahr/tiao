import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const { credentials, createNotarizer } = require("./notarize.cjs");
const env = { TIAO_SIGNED:"1", APPLE_KEYCHAIN_PROFILE:"test-profile" };
const context = {electronPlatformName:"darwin",appOutDir:"/tmp/demo",packager:{appInfo:{productFilename:"Tiao Demo"}}};

test("accepted notarization with a failed staple retries ticket delivery without resubmitting",async()=>{
  const calls = [];
  let attempts = 0;
  const hook = createNotarizer({env,warn:()=>{},wait:async()=>{},
    notarize:async()=>{calls.push("notarize");throw Error("Failed to staple your application with code: 68");},
    run:(_command,args)=>{calls.push(args[1]);assert.equal(args[2],"/tmp/demo/Tiao Demo.app");if(args[1]==="staple"&&attempts++===0)throw Error("network connection was lost");},
  });
  await hook(context);
  assert.deepEqual(calls,["notarize","staple","staple","validate"]);
});

test("notarization rejection fails immediately and never runs stapler",async()=>{
  let submissions = 0;
  const hook = createNotarizer({env,notarize:async()=>{submissions++;throw Error("Notarization invalid: signature rejected");},run:()=>assert.fail("no ticket for a rejected app"),wait:()=>assert.fail("no retry for a rejection")});
  await assert.rejects(hook(context),/signature rejected/);
  assert.equal(submissions,1);
});

test("a transient submission failure retries, then validates the accepted ticket",async()=>{
  let submissions = 0;
  const calls = [];
  const hook = createNotarizer({env,warn:()=>{},wait:async()=>{},
    notarize:async options=>{
      assert.deepEqual(options,{appPath:"/tmp/demo/Tiao Demo.app",keychainProfile:"test-profile"});
      if (++submissions === 1) throw Error("ECONNRESET");
    },
    run:(_command,args)=>calls.push(args[1]),
  });
  await hook(context);
  assert.equal(submissions,2);
  assert.deepEqual(calls,["validate"]);
});

test("a persistent ticket failure exhausts three attempts and fails the build",async()=>{
  let attempts = 0;
  const hook = createNotarizer({env,warn:()=>{},wait:async()=>{},notarize:async()=>{throw Error("Failed to staple your application with code: 68");},run:()=>{attempts++;throw Error("service unavailable");}});
  await assert.rejects(hook(context),/service unavailable/);
  assert.equal(attempts,3);
});

test("only signed Developer ID builds notarize; profile/API/Apple ID credentials stay explicit",async()=>{
  const hook = createNotarizer({env,notarize:()=>assert.fail(),run:()=>assert.fail()});
  await hook({...context,electronPlatformName:"mas"});
  await createNotarizer({env:{},notarize:()=>assert.fail(),run:()=>assert.fail()})(context);
  assert.deepEqual(credentials(env),{keychainProfile:"test-profile"});
  assert.throws(()=>credentials({APPLE_API_KEY:"path"}),/complete/);
});
