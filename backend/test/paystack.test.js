const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('crypto');
const Paystack=require('../src/services/paystack');

test('validates Paystack webhook HMAC-SHA512 with secret key',()=>{
  process.env.PAYSTACK_ENV='sandbox';
  process.env.PAYSTACK_SECRET_KEY='sk_test_unit_test_secret';
  const body={event:'charge.success',data:{reference:'abc'}};
  const signature=crypto.createHmac('sha512',process.env.PAYSTACK_SECRET_KEY).update(JSON.stringify(body)).digest('hex');
  assert.equal(Paystack.verifyWebhookSignature(body,signature,'sandbox'),true);
  assert.equal(Paystack.verifyWebhookSignature(body,'bad','sandbox'),false);
});

test('normalizes active Paystack dedicated account',()=>{
  const a=Paystack.normalizeAccount({id:1,active:true,currency:'NGN',account_number:'0123456789',account_name:'Test User',bank:{name:'Test Bank',slug:'test-bank',code:'001'},customer:{customer_code:'CUS_test'}});
  assert.equal(a.provider,'paystack');
  assert.equal(a.assignmentStatus,'active');
  assert.equal(a.active,true);
  assert.equal(a.accountNumber,'0123456789');
});

test('uses only the active Paystack key environment',()=>{
  process.env.PAYSTACK_ENV='sandbox';
  process.env.PAYSTACK_SECRET_KEY='sk_test_sandbox_secret';
  assert.equal(Paystack.configured('sandbox'),true);
  assert.equal(Paystack.configured('live'),false);
});
