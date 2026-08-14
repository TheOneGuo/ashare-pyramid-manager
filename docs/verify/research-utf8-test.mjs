const body = JSON.stringify({
  stock_code: "300750",
  stock_name: "宁德时代",
  query: "重点看产能扩张与海外客户",
});
fetch("http://localhost:9999/api/portfolio/research", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
})
  .then((r) => r.json())
  .then((j) => {
    console.log("stock_name=", j.stock_name);
    console.log("query=", j.query);
    console.log("module0.title=", j.modules[0].title);
    process.exit(0);
  })
  .catch((e) => {
    console.error("ERR", e);
    process.exit(1);
  });
