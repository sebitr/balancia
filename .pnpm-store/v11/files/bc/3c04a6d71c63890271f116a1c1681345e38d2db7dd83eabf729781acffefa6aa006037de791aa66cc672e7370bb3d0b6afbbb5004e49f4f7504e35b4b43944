import {Wa,Ua,Va,ka,l,ga,ma,Xa}from'./chunk-2CD4IZV7.js';import {Server}from'@modelcontextprotocol/sdk/server/index.js';import {ListToolsRequestSchema,CallToolRequestSchema}from'@modelcontextprotocol/sdk/types.js';import m from'dedent';import {z}from'zod';import {zodToJsonSchema}from'zod-to-json-schema';var R="shadcn@latest";async function u(r){return `${await ga(process.cwd())} ${R} ${r}`}async function d(r=process.cwd()){return {registries:(await ma(r,{useCache:false})).registries}}function _(r,t){let{query:n,registries:i}=t||{},o=r.items.map(c=>{let g=[`- ${c.name}`];return c.type&&g.push(`(${c.type})`),c.description&&g.push(`- ${c.description}`),c.registry&&g.push(`[${c.registry}]`),g.push(`
  Add command: \`${u(`add ${c.addCommandArgument}`)}\``),g.join(" ")}),a=`Found ${r.pagination.total} items`;n&&(a+=` matching "${n}"`),i&&i.length>0&&(a+=` in registries ${i.join(", ")}`),a+=":";let s=`Showing items ${r.pagination.offset+1}-${Math.min(r.pagination.offset+r.pagination.limit,r.pagination.total)} of ${r.pagination.total}:`,p=`${a}

${s}

${o.join(`

`)}`;return r.pagination.hasMore&&(p+=`

More items available. Use offset: ${r.pagination.offset+r.pagination.limit} to see the next page.`),p}function w(r){if(!r?.length)return null;let t=Xa(r);return t.length===0?null:`Unknown type${t.length===1?"":"s"}: ${t.join(", ")}. Valid types: ${Wa.join(", ")}.`}function $(r){if(!r.errors?.length)return "";let t=r.errors.map(n=>`- ${n.registry}: ${n.message}`);return `

Skipped ${r.errors.length} registr${r.errors.length===1?"y":"ies"} that failed to load:
${t.join(`
`)}`}function E(r){return r.map(t=>[`## ${t.name}`,t.description?`
${t.description}
`:"",t.type?`**Type:** ${t.type}`:"",t.files&&t.files.length>0?`**Files:** ${t.files.length} file(s)`:"",t.dependencies&&t.dependencies.length>0?`**Dependencies:** ${t.dependencies.join(", ")}`:"",t.devDependencies&&t.devDependencies.length>0?`**Dev Dependencies:** ${t.devDependencies.join(", ")}`:""].filter(Boolean).join(`
`))}function v(r,t){let n=r.map(o=>{let a=[`## Example: ${o.name}`,o.description?`
${o.description}
`:""];return o.files?.length&&o.files.forEach(s=>{s.content&&(a.push(`### Code (${s.path}):
`),a.push("```tsx"),a.push(s.content),a.push("```"));}),a.filter(Boolean).join(`
`)});return `# Usage Examples

Found ${r.length} example${r.length>1?"s":""} matching "${t}":
`+n.join(`

---

`)}var C=new Server({name:"shadcn",version:"1.0.0"},{capabilities:{resources:{},tools:{}}});C.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:"get_project_registries",description:"Get configured registry names from components.json - Returns error if no components.json exists (use init_project to create one)",inputSchema:zodToJsonSchema(z.object({}))},{name:"list_items_in_registries",description:"List items from registries (requires components.json - use init_project if missing)",inputSchema:zodToJsonSchema(z.object({registries:z.array(z.string()).optional().describe("Array of registry names to list (e.g., ['@shadcn', '@acme']). Omit to list from every registry configured in components.json."),types:z.array(z.string()).optional().describe(`Filter by item type. One of: ${Wa.join(", ")}.`),limit:z.number().optional().describe("Maximum number of items to return (defaults to 100; use 0 for no limit)"),offset:z.number().optional().describe("Number of items to skip for pagination")}))},{name:"search_items_in_registries",description:"Search for components in registries using fuzzy matching (requires components.json). After finding an item, use get_item_examples_from_registries to see usage examples.",inputSchema:zodToJsonSchema(z.object({registries:z.array(z.string()).optional().describe("Array of registry names to search (e.g., ['@shadcn', '@acme']). Omit to search every registry configured in components.json."),query:z.string().describe("Search query string for fuzzy matching against item names and descriptions"),types:z.array(z.string()).optional().describe(`Filter by item type. One of: ${Wa.join(", ")}.`),limit:z.number().optional().describe("Maximum number of items to return (defaults to 100; use 0 for no limit)"),offset:z.number().optional().describe("Number of items to skip for pagination")}))},{name:"view_items_in_registries",description:"View detailed information about specific registry items including the name, description, type and files content. For usage examples, use get_item_examples_from_registries instead.",inputSchema:zodToJsonSchema(z.object({items:z.array(z.string()).describe("Array of item names with registry prefix (e.g., ['@shadcn/button', '@shadcn/card'])")}))},{name:"get_item_examples_from_registries",description:"Find usage examples and demos with their complete code. Search for patterns like 'accordion-demo', 'button example', 'card-demo', etc. Returns full implementation code with dependencies.",inputSchema:zodToJsonSchema(z.object({registries:z.array(z.string()).optional().describe("Array of registry names to search (e.g., ['@shadcn', '@acme']). Omit to search every registry configured in components.json."),query:z.string().describe("Search query for examples (e.g., 'accordion-demo', 'button demo', 'card example', 'tooltip-demo', 'example-booking-form', 'example-hero'). Common patterns: '{item-name}-demo', '{item-name} example', 'example {item-name}'")}))},{name:"get_add_command_for_items",description:"Get the shadcn CLI add command for specific items in a registry. This is useful for adding one or more components to your project.",inputSchema:zodToJsonSchema(z.object({items:z.array(z.string()).describe("Array of items to get the add command for prefixed with the registry name (e.g., ['@shadcn/button', '@shadcn/card'])")}))},{name:"get_audit_checklist",description:"After creating new components or generating new code files, use this tool for a quick checklist to verify that everything is working as expected. Make sure to run the tool after all required steps have been completed.",inputSchema:zodToJsonSchema(z.object({}))}]}));C.setRequestHandler(CallToolRequestSchema,async r=>{try{if(!r.params.arguments)throw new Error("No tool arguments provided.");switch(r.params.name){case "get_project_registries":{let t=await d(process.cwd());return t?.registries?{content:[{type:"text",text:m`The following registries are configured in the current project:

                ${Object.keys(t.registries).map(n=>`- ${n}`).join(`
`)}

                You can view the items in a registry by running:
                \`${await u("view @name-of-registry")}\`

                For example: \`${await u("view @shadcn")}\` or \`${await u("view @shadcn @acme")}\` to view multiple registries.
                `}]}:{content:[{type:"text",text:m`No components.json found or no registries configured.

                To fix this:
                1. Use the \`init\` command to create a components.json file
                2. Or manually create components.json with a registries section`}]}}case "search_items_in_registries":{let n=z.object({registries:z.array(z.string()).optional(),query:z.string(),types:z.array(z.string()).optional(),limit:z.number().optional(),offset:z.number().optional()}).parse(r.params.arguments),i=w(n.types);if(i)return {content:[{type:"text",text:i}],isError:!0};let o=await d(process.cwd()),a=!n.registries?.length,s=Ua(n.registries??[],o);if(s.length===0)return {content:[{type:"text",text:m`No registries are configured. Add registries to components.json (use get_project_registries to inspect) or pass them explicitly.`}]};let p=await Va(s,{query:n.query,types:n.types,limit:n.limit??100,offset:n.offset,config:o,useCache:!1,continueOnError:a}),c=$(p);return p.items.length===0?{content:[{type:"text",text:m`No items found matching "${n.query}" in registries ${s.join(", ")}, Try searching with a different query or registry.${c}`}]}:{content:[{type:"text",text:_(p,{query:n.query,registries:s})+c}]}}case "list_items_in_registries":{let n=z.object({registries:z.array(z.string()).optional(),types:z.array(z.string()).optional(),limit:z.number().optional(),offset:z.number().optional(),cwd:z.string().optional()}).parse(r.params.arguments),i=w(n.types);if(i)return {content:[{type:"text",text:i}],isError:!0};let o=await d(process.cwd()),a=!n.registries?.length,s=Ua(n.registries??[],o);if(s.length===0)return {content:[{type:"text",text:m`No registries are configured. Add registries to components.json (use get_project_registries to inspect) or pass them explicitly.`}]};let p=await Va(s,{types:n.types,limit:n.limit??100,offset:n.offset,config:o,useCache:!1,continueOnError:a}),c=$(p);return p.items.length===0?{content:[{type:"text",text:m`No items found in registries ${s.join(", ")}.${c}`}]}:{content:[{type:"text",text:_(p,{registries:s})+c}]}}case "view_items_in_registries":{let n=z.object({items:z.array(z.string())}).parse(r.params.arguments),i=await ka(n.items,{config:await d(process.cwd()),useCache:!1});if(i?.length===0)return {content:[{type:"text",text:m`No items found for: ${n.items.join(", ")}

                Make sure the item names are correct and include the registry prefix (e.g., @shadcn/button).`}]};let o=E(i);return {content:[{type:"text",text:m`Item Details:

              ${o.join(`

---

`)}`}]}}case "get_item_examples_from_registries":{let n=z.object({query:z.string(),registries:z.array(z.string()).optional()}).parse(r.params.arguments),i=await d(),o=!n.registries?.length,a=Ua(n.registries??[],i);if(a.length===0)return {content:[{type:"text",text:m`No registries are configured. Add registries to components.json (use get_project_registries to inspect) or pass them explicitly.`}]};let s=await Va(a,{query:n.query,config:i,useCache:!1,continueOnError:o});if(s.items.length===0)return {content:[{type:"text",text:m`No examples found for query "${n.query}".

                Try searching with patterns like:
                - "accordion-demo" for accordion examples
                - "button demo" or "button example"
                - Component name followed by "-demo" or "example"

                You can also:
                1. Use search_items_in_registries to find all items matching your query
                2. View the main component with view_items_in_registries for inline usage documentation`}]};let p=s.items.map(g=>g.addCommandArgument),c=await ka(p,{config:i,useCache:!1});return {content:[{type:"text",text:v(c,n.query)}]}}case "get_add_command_for_items":{let t=z.object({items:z.array(z.string())}).parse(r.params.arguments);return {content:[{type:"text",text:await u(`add ${t.items.join(" ")}`)}]}}case "get_audit_checklist":return {content:[{type:"text",text:m`## Component Audit Checklist

              After adding or generating components, check the following common issues:

              - [ ] Ensure imports are correct i.e named vs default imports
              - [ ] If using next/image, ensure images.remotePatterns next.config.js is configured correctly.
              - [ ] Ensure all dependencies are installed.
              - [ ] Check for linting errors or warnings
              - [ ] Check for TypeScript errors
              - [ ] Use the Playwright MCP if available.
              `}]};default:throw new Error(`Tool ${r.params.name} not found`)}}catch(t){if(t instanceof z.ZodError)return {content:[{type:"text",text:m`Invalid input parameters:
              ${t.errors.map(i=>`- ${i.path.join(".")}: ${i.message}`).join(`
`)}
              `}],isError:true};if(t instanceof l){let i=t.message;return t.suggestion&&(i+=`

\u{1F4A1} ${t.suggestion}`),t.context&&(i+=`

Context: ${JSON.stringify(t.context,null,2)}`),{content:[{type:"text",text:m`Error (${t.code}): ${i}`}],isError:true}}let n=t instanceof Error?t.message:String(t);return {content:[{type:"text",text:m`Error: ${n}`}],isError:true}}});export{C as a};