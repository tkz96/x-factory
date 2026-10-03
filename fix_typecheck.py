import re

with open("src/providers/azure-module.ts", "r") as f:
    content = f.read()

# Remove unused imports
content = re.sub(r'import \{ fetchAzureTickets \} from "../trackers/azure\.js";\n', '', content)
content = re.sub(r'import \{ normalizeGitRef \} from "../azure/pr\.js";\n', '', content)
content = re.sub(r'import \{\n  type CliCommandExecutor,\n  formatAzureAuthHeader,\n  getAzureCliAuthHeader,\n\} from "../azure/auth\.js";\n', '', content)
content = re.sub(r'import type \{ TrackerTicket \} from "../trackers/index\.js";\n', '', content)

# Remove the duplicated unused variables in listTickets
content = re.sub(r'      const \{ orgUrl, project, pat \} = parsed\.data;\n', '', content)
content = re.sub(r'      const parsed = azureConfigSchema\.safeParse\(config\);\n      if \(!parsed\.success\) \{\n        throw new Error\(`Invalid Azure configuration: \$\{parsed\.error\.message\}`\);\n      \}\n\n', '', content)

# Replace 'project' in fallbackUrl
content = content.replace(
    'const fallbackUrl = `${cleanOrgUrl}/${encodeURIComponent(project)}/_workitems/edit/${item.id}`;',
    'const fallbackUrl = `${cleanOrgUrl}/${encodedProject}/_workitems/edit/${item.id}`;'
)

with open("src/providers/azure-module.ts", "w") as f:
    f.write(content)

