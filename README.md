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

  const handleShare = async () => {
    try {
      const imageUrl = story?.image;
      const fileUri = FileSystem.cacheDirectory + "shared-image.jpg";
      if (imageUrl) {
        const downloadResumable = FileSystem.createDownloadResumable(
          imageUrl,
          fileUri
        );
        await downloadResumable.downloadAsync();
      }
      const uri = imageUrl ? fileUri : undefined;
      // Use universal link for sharing
      const deepLink = `https://share.mosaicai.in/story/${story?._id}`;
      // Always use chapter 1's title/description if available
      const chapter1 =
        story?.chapters && story.chapters.length > 0 ? story.chapters[0] : null;
      let title = cleanText(chapter1?.title);
      let description = cleanText(chapter1?.description);
      if (!title || !description) {
        // Fallback to first line/words of text
        const text = chapter1?.text || story?.title || "";
        const lines = text
          .split(/\r?\n/)
          .map((l: string) => l.trim())
          .filter(Boolean);
        const firstLine = lines[0] || "";
        const words = firstLine.split(" ");
        title = title || cleanText(words.slice(0, 5).join(" "));
        description = description || cleanText(words.slice(5, 14).join(" "));
      }
      const shareText = `🌟 Hey! Here's a dreamy bedtime story from Mosaic:\n${title}\n${description}\n✨\nTap below to read the full adventure\n⬇️\n👉 ${deepLink}`;
      const shareOptions = {
        title: "Share Story",
        message: shareText,
        url: uri,
        type: uri ? "image/jpeg" : undefined,
      };
      await Share.open(shareOptions);
    } catch (error) {
      console.error("Error sharing:", error);
    }
  };
