import re

with open("src/providers/azure-module.ts", "r") as f:
    content = f.read()

content = content.replace('const raw = res.data as any;', 'const raw = res.data as { workItems?: Array<{ id: number }> };')
content = content.replace('raw.workItems.map((w: any) => w.id)', 'raw.workItems.map((w) => w.id)')
content = content.replace('const itemsRaw = itemsRes.data as any;', 'const itemsRaw = itemsRes.data as { value?: Array<Record<string, unknown>> };')
content = content.replace('return items.map((item: any) => {', 'return items.map((item: Record<string, unknown>) => {')
content = content.replace('const fields = item.fields || {};', 'const fields = (item.fields as Record<string, unknown>) || {};')
content = content.replace('item._links?.html?.href', '(item._links as any)?.html?.href')

with open("src/providers/azure-module.ts", "w") as f:
    f.write(content)

