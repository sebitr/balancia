import { __decorate } from "tslib";
import { AsnProp, AsnPropTypes, } from "@peculiar/asn1-schema";
export class AttestationPackageInfo {
    packageName;
    version;
    constructor(params = {}) {
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({ type: AsnPropTypes.OctetString })
], AttestationPackageInfo.prototype, "packageName", void 0);
__decorate([
    AsnProp({ type: AsnPropTypes.Integer })
], AttestationPackageInfo.prototype, "version", void 0);
export class AttestationApplicationId {
    packageInfos;
    signatureDigests;
    constructor(params = {}) {
        Object.assign(this, params);
    }
}
__decorate([
    AsnProp({
        type: AttestationPackageInfo, repeated: "set",
    })
], AttestationApplicationId.prototype, "packageInfos", void 0);
__decorate([
    AsnProp({
        type: AsnPropTypes.OctetString, repeated: "set",
    })
], AttestationApplicationId.prototype, "signatureDigests", void 0);
