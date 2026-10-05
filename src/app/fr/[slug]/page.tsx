import { comparisonRoute } from "@/components/marketing/comparison-route";

// The comparison pages in French: `/fr/alternative-splitwise`. The English
// ones are folders of their own; see `comparison-route.tsx` for why every
// other language's are looked up instead.
const route = comparisonRoute("fr");

export const generateMetadata = route.generateMetadata;
export default route.Page;
