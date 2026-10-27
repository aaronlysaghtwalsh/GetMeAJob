import { ExtractionSchema } from "../src/shared/schemas/brain.ts";
import { toProviderJsonSchema } from "../src/server/ai/schema.ts";

const schema = toProviderJsonSchema(ExtractionSchema);
console.log(JSON.stringify(schema, null, 2));
