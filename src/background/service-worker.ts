import { registerMessageRouter } from "./message-router";
import { registerPdfEditorRouter } from "./pdf-editor-router";
import { registerPdfSourceRouter } from "./pdf-source-router";
import { registerPersistentJobRouter } from "./persistent-job-router";

registerMessageRouter();
registerPersistentJobRouter();
registerPdfEditorRouter();
registerPdfSourceRouter();
