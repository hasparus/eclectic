# BlockNote with Y.js Comments Example

```tsx
import { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteView, useCreateBlockNote } from "@blocknote/react";
import * as Y from "yjs";
import { useEffect, useState } from "react";

// Types
interface Comment {
  id: string;
  anchor: Y.RelativePosition;
  content: string;
  createdAt: number;
}

export function EditorWithComments() {
  const [doc] = useState(() => new Y.Doc());
  const [provider, setProvider] = useState<any>(null);
  const [comments, setComments] = useState<Comment[]>([]);

  const editor = useCreateBlockNote({
    collaboration: {
      fragment: doc.getXmlFragment("document-store"),
      user: {
        name: "My User",
        color: "#ff0000",
      },
      provider,
      renderCursor: (user) => {
        const cursor = document.createElement("div");
        cursor.classList.add("cursor");
        cursor.style.backgroundColor = user.color;
        return cursor;
      },
    },
  });

  // Load comments from Y.js map or array
  useEffect(() => {
    const commentsArray = doc.getArray<Y.Map<any>>("comments");
    
    const updateComments = () => {
      const loaded: Comment[] = commentsArray.map((c) => ({
        id: c.get("id"),
        anchor: c.get("anchor"),
        content: c.get("content"),
        createdAt: c.get("createdAt"),
      }));
      setComments(loaded);
    };

    commentsArray.observe(updateComments);
    return () => commentsArray.unobserve(updateComments);
  }, [doc]);

  // Function to add a comment at current selection
  const addComment = () => {
    const selection = editor.getSelection();
    if (!selection) return;

    const blockId = selection.blocks[0].id;
    
    const newComment = new Y.Map();
    newComment.set("id", crypto.randomUUID());
    newComment.set("blockId", blockId);
    newComment.set("content", "New Comment");
    newComment.set("createdAt", Date.now());

    doc.getArray("comments").push([newComment]);
  };

  return (
    <div className="editor-container">
      <button onClick={addComment}>Add Comment</button>
      <div className="split-view">
        <BlockNoteView editor={editor} />
        <div className="comments-sidebar">
          {comments.map(c => (
            <div key={c.id} className="comment-bubble">
              {c.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

## Key Points from GitHub Examples

From `toeverything/AFFiNE` and `toeverything/blocksuite`:
- Use `Y.createRelativePositionFromTypeIndex(yText, index)` to anchor comments
- Store relative positions in Y.Map or Y.Array for persistence
- Resolve positions back using `Y.createAbsolutePositionFromRelativePosition()`
