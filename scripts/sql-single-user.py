"""Put each SQL statement on one line for PostgreSQL's socket-free single-user mode.

This is only a migration-check helper. It handles the SQL quoting forms used in
CrossCulture migrations and raises on an incomplete final statement.
"""

import re
import sys
from pathlib import Path

source = Path(sys.argv[1]).read_text()
statements = []
buffer = []
quote = None
index = 0

while index < len(source):
    char = source[index]
    next_char = source[index + 1] if index + 1 < len(source) else ""

    if quote == "line_comment":
        if char == "\n":
            quote = None
            buffer.append(" ")
        index += 1
        continue
    if quote and quote.startswith("$"):
        if source.startswith(quote, index):
            buffer.append(quote)
            index += len(quote)
            quote = None
        else:
            buffer.append(" " if char == "\n" else char)
            index += 1
        continue
    if quote in ("'", '"'):
        buffer.append(char)
        if char == quote:
            if next_char == quote:
                buffer.append(next_char)
                index += 2
                continue
            quote = None
        index += 1
        continue

    if char == "-" and next_char == "-":
        quote = "line_comment"
        index += 2
    elif char in ("'", '"'):
        quote = char
        buffer.append(char)
        index += 1
    elif char == "$" and (match := re.match(r"\$[A-Za-z_0-9]*\$", source[index:])):
        quote = match.group()
        buffer.append(quote)
        index += len(quote)
    elif char == ";":
        statement = "".join(buffer).strip()
        if statement:
            statements.append(statement + ";")
        buffer = []
        index += 1
    else:
        buffer.append(" " if char == "\n" else char)
        index += 1

if quote not in (None, "line_comment") or "".join(buffer).strip():
    raise SystemExit("Incomplete SQL statement or quote in migration")

print("\n".join(statements))
