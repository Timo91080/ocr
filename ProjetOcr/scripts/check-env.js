import 'dotenv/config';

const keys = ['OCRSPACE_API_KEY','GROQ_API_KEY','LLM_PROVIDER','USE_OCRSPACE'];
for (const k of keys) {
  const v = process.env[k];
  console.log(k.padEnd(18), v ? `SET length=${v.length}` : 'ABSENT');
}
