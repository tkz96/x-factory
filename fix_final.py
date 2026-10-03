import re

with open("src/providers/azure-module.ts", "r") as f:
    content = f.read()

# Fix imports
content = re.sub(
    r'  type VerificationWarning,\n\} from "\./contract\.js";',
    '  type VerificationWarning,\n  REQUIRED_WORKFLOW_LABEL,\n  type TrackerTicket,\n} from "./contract.js";',
    content
)

# Read helpers
with open("/tmp/agy-fixes/azure-helpers.ts", "r") as f:
    helpers = f.read()

# Append helpers at the end if they are not already there
if "formatAzureAuthHeader" not in content:
    content += "\n\n" + helpers

with open("src/providers/azure-module.ts", "w") as f:
    f.write(content)

