const base = "http://localhost:9999";
async function hdr(method, path, headers={}, body){
  const init={method, headers};
  if(body!==undefined) init.body=JSON.stringify(body);
  const r = await fetch(base+path, init);
  const acao = r.headers.get("access-control-allow-origin");
  let json; try{json=await r.json()}catch(e){json=null}
  return {status:r.status, acao, json};
}
(async()=>{
  let r = await hdr("GET","/api/health",{Origin:"http://evil.example.com"});
  console.log("CORS evil origin acao:", r.acao, "(expect null)");
  r = await hdr("GET","/api/health",{Origin:"http://localhost:5173"});
  console.log("CORS localhost:5173 acao:", r.acao, "(expect http://localhost:5173)");
  r = await hdr("POST","/api/holdings",{},{stock_code:"600519",shares:100,cost_basis:1700});
  console.log("POST /api/holdings no-auth (DEV, expect ok):", r.status, JSON.stringify(r.json));
  r = await hdr("POST","/api/holdings",{},{stock_code:"' OR '1'='1",shares:-5});
  console.log("POST /api/holdings bad input (expect 400):", r.status, JSON.stringify(r.json));
  const rr = await fetch(base+"/api/portfolio/plans",{method:"POST",headers:{"Content-Type":"application/json"},body:"{not json"});
  let t=""; try{t=await rr.text()}catch(e){t="(no body)"}
  console.log("malformed JSON (expect 400):", rr.status, t);
})();
