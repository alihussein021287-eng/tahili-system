export function sumPrometheusMetric(text, key) {
  return text.split("\n")
    .filter((line) => line.startsWith(`${key}{`) || line.startsWith(`${key} `))
    .reduce((total, line) => total + Number(line.trim().split(/\s+/).at(-1) || 0), 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [url, ...keys] = process.argv.slice(2);
  if (!url || !keys.length) process.exit(2);
  const response = await fetch(url);
  if (!response.ok) process.exit(1);
  const text = await response.text();
  console.log(JSON.stringify(Object.fromEntries(keys.map((key) => [key, sumPrometheusMetric(text, key)]))));
}
