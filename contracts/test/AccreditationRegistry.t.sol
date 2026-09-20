// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AccreditationRegistry} from "../src/AccreditationRegistry.sol";

contract AccreditationRegistryTest is Test {
    AccreditationRegistry registry;
    address authorityAdmin = address(0x111);
    address institutionAdmin = address(0x222);
    address issuer = address(0x333);
    bytes32 institutionId = keccak256("inst.example");

    function setUp() public {
        vm.warp(1000 days);
        vm.prank(authorityAdmin);
        registry = new AccreditationRegistry(authorityAdmin);
    }

    function testRegisterInstitution() public {
        vm.prank(authorityAdmin);
        registry.registerInstitution(institutionId, institutionAdmin, uint64(block.timestamp), uint64(block.timestamp + 365 days), "ipfs://inst");
        
        AccreditationRegistry.Institution memory inst = registry.getInstitution(institutionId);
        assertEq(inst.admin, institutionAdmin);
        assertEq(uint(inst.status), uint(AccreditationRegistry.AccreditationStatus.Accredited));
    }

    function testUpdateAccreditation() public {
        vm.prank(authorityAdmin);
        registry.registerInstitution(institutionId, institutionAdmin, uint64(block.timestamp), uint64(block.timestamp + 365 days), "ipfs://inst");
        
        vm.prank(authorityAdmin);
        registry.updateAccreditation(institutionId, uint64(block.timestamp + 10 days), AccreditationRegistry.AccreditationStatus.Suspended, "ipfs://new");

        AccreditationRegistry.Institution memory inst = registry.getInstitution(institutionId);
        assertEq(uint(inst.status), uint(AccreditationRegistry.AccreditationStatus.Suspended));
        assertEq(inst.validUntil, uint64(block.timestamp + 10 days));
    }

    function testAuthorizeIssuer() public {
        vm.prank(authorityAdmin);
        registry.registerInstitution(institutionId, institutionAdmin, uint64(block.timestamp), uint64(block.timestamp + 365 days), "ipfs://inst");
        
        vm.prank(institutionAdmin);
        registry.authorizeIssuer(institutionId, issuer, "ipfs://issuer");

        assertTrue(registry.isIssuerAuthorized(issuer));
    }

    function testRevokeIssuerByInstitutionAdmin() public {
        vm.prank(authorityAdmin);
        registry.registerInstitution(institutionId, institutionAdmin, uint64(block.timestamp), uint64(block.timestamp + 365 days), "ipfs://inst");
        
        vm.prank(institutionAdmin);
        registry.authorizeIssuer(institutionId, issuer, "ipfs://issuer");

        vm.prank(institutionAdmin);
        registry.revokeIssuer(issuer);

        assertFalse(registry.isIssuerAuthorized(issuer));
    }

    function testRevokeIssuerByAuthority() public {
        vm.prank(authorityAdmin);
        registry.registerInstitution(institutionId, institutionAdmin, uint64(block.timestamp), uint64(block.timestamp + 365 days), "ipfs://inst");
        
        vm.prank(institutionAdmin);
        registry.authorizeIssuer(institutionId, issuer, "ipfs://issuer");

        vm.prank(authorityAdmin);
        registry.revokeIssuer(issuer);

        assertFalse(registry.isIssuerAuthorized(issuer));
    }

    function testExpiredInstitutionMakesIssuerUnauthorized() public {
        vm.prank(authorityAdmin);
        registry.registerInstitution(institutionId, institutionAdmin, uint64(block.timestamp - 10 days), uint64(block.timestamp - 1 days), "ipfs://inst");
        
        vm.prank(institutionAdmin);
        registry.authorizeIssuer(institutionId, issuer, "ipfs://issuer");

        assertFalse(registry.isIssuerAuthorized(issuer));
    }

    function testUnauthorizedAccess() public {
        // Non-authority trying to register
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        registry.registerInstitution(institutionId, institutionAdmin, uint64(block.timestamp), uint64(block.timestamp + 365 days), "ipfs://inst");

        vm.prank(authorityAdmin);
        registry.registerInstitution(institutionId, institutionAdmin, uint64(block.timestamp), uint64(block.timestamp + 365 days), "ipfs://inst");

        // Non-institution admin trying to authorize
        vm.prank(address(0xBEEF));
        vm.expectRevert("Caller is not institution admin");
        registry.authorizeIssuer(institutionId, issuer, "ipfs://issuer");
    }

    function testIsAccreditedReturnsTrueWhenValid() public {
        vm.prank(authorityAdmin);
        registry.registerInstitution(institutionId, institutionAdmin, uint64(block.timestamp), uint64(block.timestamp + 365 days), "ipfs://inst");

        assertTrue(registry.isAccredited(institutionId));
    }

    function testIsAccreditedReturnsFalseWhenSuspended() public {
        vm.prank(authorityAdmin);
        registry.registerInstitution(institutionId, institutionAdmin, uint64(block.timestamp), uint64(block.timestamp + 365 days), "ipfs://inst");

        vm.prank(authorityAdmin);
        registry.updateAccreditation(institutionId, uint64(block.timestamp + 365 days), AccreditationRegistry.AccreditationStatus.Suspended, "ipfs://inst");

        assertFalse(registry.isAccredited(institutionId));
    }

    function testIsAccreditedReturnsFalseWhenExpired() public {
        vm.prank(authorityAdmin);
        registry.registerInstitution(institutionId, institutionAdmin, uint64(block.timestamp - 100 days), uint64(block.timestamp - 1 days), "ipfs://inst");

        assertFalse(registry.isAccredited(institutionId));
    }

    function testIsAccreditedReturnsFalseWhenUnknown() public view {
        bytes32 unknownId = keccak256("unknown.institution");
        assertFalse(registry.isAccredited(unknownId));
    }
}
