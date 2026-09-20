// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract AccreditationRegistry is AccessControl {
    bytes32 public constant AUTHORITY_ROLE = keccak256("AUTHORITY_ROLE");

    enum AccreditationStatus { Pending, Accredited, Suspended, Revoked, Rejected }

    struct Institution {
        address admin;
        uint64 validFrom;
        uint64 validUntil;
        AccreditationStatus status;
        string metadataUri;
    }

    struct Issuer {
        bytes32 institutionId;
        bool revoked;
        string metadataUri;
    }

    mapping(bytes32 => Institution) public institutions;
    mapping(address => Issuer) public issuers;

    event InstitutionRegistered(bytes32 indexed id, address indexed admin, uint64 validFrom, uint64 validUntil, string metadataUri);
    event AccreditationUpdated(bytes32 indexed id, uint64 validUntil, AccreditationStatus status, string metadataUri);
    event IssuerAuthorized(bytes32 indexed institutionId, address indexed issuer, string metadataUri);
    event IssuerRevoked(bytes32 indexed institutionId, address indexed issuer);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AUTHORITY_ROLE, admin);
    }

    function registerInstitution(
        bytes32 id,
        address admin,
        uint64 validFrom,
        uint64 validUntil,
        string calldata metadataUri
    ) external onlyRole(AUTHORITY_ROLE) {
        require(admin != address(0), "Invalid admin");
        require(validUntil > validFrom, "Invalid validity period");
        require(institutions[id].admin == address(0), "Institution already exists");

        institutions[id] = Institution({
            admin: admin,
            validFrom: validFrom,
            validUntil: validUntil,
            status: AccreditationStatus.Accredited,
            metadataUri: metadataUri
        });

        emit InstitutionRegistered(id, admin, validFrom, validUntil, metadataUri);
    }

    function updateAccreditation(
        bytes32 id,
        uint64 validUntil,
        AccreditationStatus status,
        string calldata metadataUri
    ) external onlyRole(AUTHORITY_ROLE) {
        Institution storage inst = institutions[id];
        require(inst.admin != address(0), "Institution not found");

        inst.validUntil = validUntil;
        inst.status = status;
        inst.metadataUri = metadataUri;

        emit AccreditationUpdated(id, validUntil, status, metadataUri);
    }

    function authorizeIssuer(
        bytes32 institutionId,
        address issuer,
        string calldata metadataUri
    ) external {
        Institution memory inst = institutions[institutionId];
        require(inst.admin != address(0), "Institution not found");
        require(msg.sender == inst.admin, "Caller is not institution admin");
        require(issuer != address(0), "Invalid issuer");
        require(issuers[issuer].institutionId == bytes32(0), "Issuer already authorized");

        issuers[issuer] = Issuer({
            institutionId: institutionId,
            revoked: false,
            metadataUri: metadataUri
        });

        emit IssuerAuthorized(institutionId, issuer, metadataUri);
    }

    function revokeIssuer(address issuer) external {
        Issuer storage iss = issuers[issuer];
        require(iss.institutionId != bytes32(0), "Issuer not found");
        Institution memory inst = institutions[iss.institutionId];

        // Can be revoked by the institution admin or by a global authority
        require(msg.sender == inst.admin || hasRole(AUTHORITY_ROLE, msg.sender), "Unauthorized revocation");

        iss.revoked = true;
        emit IssuerRevoked(iss.institutionId, issuer);
    }

    function isIssuerAuthorized(address issuer) external view returns (bool) {
        Issuer memory iss = issuers[issuer];
        if (iss.institutionId == bytes32(0) || iss.revoked) {
            return false;
        }

        Institution memory inst = institutions[iss.institutionId];
        return inst.status == AccreditationStatus.Accredited &&
               block.timestamp >= inst.validFrom &&
               block.timestamp <= inst.validUntil;
    }

    function isAccredited(bytes32 id) external view returns (bool) {
        Institution memory inst = institutions[id];
        return inst.admin != address(0) &&
               inst.status == AccreditationStatus.Accredited &&
               block.timestamp >= inst.validFrom &&
               block.timestamp <= inst.validUntil;
    }

    function getInstitution(bytes32 id) external view returns (Institution memory) {
        return institutions[id];
    }
}
