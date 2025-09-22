# backend

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.16. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.

## Support Issue Endpoint

POST /api/support

Body:

```
{
  "type": "string", // required, e.g. 'Bug Report'
  "description": "string" // required
}
```

Response:

- 201: { message: 'Support issue submitted successfully.' }
- 400: { message: 'Type and description are required.' }
- 500: { message: 'Failed to submit support issue.' }

<!-- backend -->
