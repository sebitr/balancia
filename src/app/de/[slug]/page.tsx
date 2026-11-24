import { comparisonRoute } from "@/components/marketing/comparison-route";

// The comparison pages in German: `/de/splitwise-alternative` and
// `/de/tricount-alternative`. German currently uses the English slugs.
const route = comparisonRoute("de");

export const generateMetadata = route.generateMetadata;
export default route.Page;
