/*

Hyper JSON Transformations
--------------------------

The Hyper JSON representation renders verbosely as a D3 tree; therefore, perform the following transformations.

Render a few pre-defined keys ("left", "right", "input" and a few others) always as direct input nodes.
For most other nodes, decide based on their value: if it is of a plain type (string, number, ...), show it as part
of the tooltip; otherwise show it as part of the tree.
A short list of special-cased keys (e.g., "analyze") is always displayed as part of the tooltip.
The label for a tree node is taken from the first defined property among "operator", "expression" and "mode".

*/

import * as treeDescription from "./tree-description";
import {TreeNode, TreeDescription, Crosslink} from "./tree-description";
import {Json, forceToString, tryToString, formatMetric, hasOwnProperty, hasSubOject} from "./loader-utils";

// Convert Hyper JSON to a D3 tree
function convertHyper(node: Json, parentKey: string): TreeNode | TreeNode[] {
    if (tryToString(node) !== undefined) {
        return {
            text: tryToString(node),
        };
    } else if (typeof node === "object" && !Array.isArray(node) && node !== null) {
        // "Object" nodes
        let explicitChildren = [] as TreeNode[];
        const additionalChildren = [] as TreeNode[];
        const properties = {};

        // Take the first present tagKey as the new tag. Add all others as properties
        const tagKeys = ["operator", "expression", "mode"];
        let tag: string | undefined;
        for (const tagKey of tagKeys) {
            if (!node.hasOwnProperty(tagKey)) {
                continue;
            }
            if (tag === undefined) {
                tag = tryToString(node[tagKey]);
            } else {
                properties[tagKey] = forceToString(node[tagKey]);
            }
        }
        if (tag === undefined) {
            tag = parentKey;
        }

        // Add the following keys as children
        const childKeys = ["input", "left", "right", "arguments", "value", "valueForComparison"];
        for (const key of childKeys) {
            if (!node.hasOwnProperty(key)) {
                continue;
            }
            const child = convertHyper(node[key], key);
            if (Array.isArray(child)) {
                explicitChildren = explicitChildren.concat(child);
            } else {
                explicitChildren.push(child);
            }
        }

        // Add the following keys as children only when they refer to objects and display as properties if not
        const objectKeys = ["source"];
        for (const key of objectKeys) {
            if (!node.hasOwnProperty(key)) {
                continue;
            }
            if (typeof node[key] !== "object") {
                properties[key] = forceToString(node[key]);
                continue;
            }
            const child = convertHyper(node[key], key);
            if (Array.isArray(child)) {
                explicitChildren = explicitChildren.concat(child);
            } else {
                explicitChildren.push(child);
            }
        }

        // Display these properties always as properties, even if they are more complex
        const propertyKeys = ["analyze"];
        for (const key of propertyKeys) {
            if (!node.hasOwnProperty(key)) {
                continue;
            }
            properties[key] = forceToString(node[key]);
        }

        // Display all other properties adaptively: simple expressions are displayed as properties, all others as part of the tree
        const handledKeys = tagKeys.concat(childKeys, objectKeys, propertyKeys);
        for (const key of Object.getOwnPropertyNames(node)) {
            if (handledKeys.indexOf(key) !== -1) {
                continue;
            }

            // Try to display as string property
            const str = tryToString(node[key]);
            if (str !== undefined) {
                properties[key] = str;
                continue;
            }

            // Display as part of the tree
            const innerNodes = convertHyper(node[key], key);
            if (Array.isArray(innerNodes)) {
                additionalChildren.push({tag: key, children: innerNodes});
            } else {
                additionalChildren.push({tag: key, children: [innerNodes]});
            }
        }

        // Display the cardinality on the links between the nodes
        let edgeLabel: string | undefined = undefined;
        if (hasOwnProperty(node, "cardinality") && typeof node.cardinality === "number") {
            edgeLabel = formatMetric(node.cardinality);
        }
        // Collapse nodes as appropriate
        let children: TreeNode[];
        let _children: TreeNode[];
        if (node.hasOwnProperty("plan")) {
            // The top-level plan element needs special attention: we want to hide the `header` by default
            _children = explicitChildren.concat(additionalChildren);
            const planIdx = _children.findIndex(function(n) {
                return n.tag === "plan";
            });
            children = [_children[planIdx]];
        } else if (node.hasOwnProperty("operator")) {
            // For operators, the additionalChildren are collapsed by default
            children = explicitChildren;
            _children = explicitChildren.concat(additionalChildren);
        } else {
            // Everything else (usually expressions): display uncollapsed
            children = explicitChildren.concat(additionalChildren);
            _children = [];
        }
        // Build the converted node
        const convertedNode = {
            tag: tag,
            properties: properties,
            children: children,
            _children: _children,
            edgeLabel: edgeLabel,
        };
        return convertedNode;
    } else if (Array.isArray(node)) {
        // "Array" nodes
        const listOfObjects = [] as TreeNode[];
        for (let index = 0; index < node.length; ++index) {
            const value = node[index];
            const innerNode = convertHyper(value, parentKey + "." + index.toString());
            // objectify nested arrays
            if (Array.isArray(innerNode)) {
                innerNode.forEach(function(value, _index) {
                    listOfObjects.push(value);
                });
            } else {
                listOfObjects.push(innerNode);
            }
        }
        return listOfObjects;
    }
    throw new Error("Invalid Hyper query plan");
}

// Function to generate nodes' display names based on their properties
function generateDisplayNames(treeRoot: TreeNode) {
    treeDescription.visitTreeNodes(
        treeRoot,
        function(node) {
            switch (node.tag) {
                case "join":
                    node.name = node.tag;
                    node.symbol = "inner-join-symbol";
                    break;
                case "leftouterjoin":
                    node.name = node.tag;
                    node.symbol = "left-join-symbol";
                    break;
                case "rightouterjoin":
                    node.name = node.tag;
                    node.symbol = "right-join-symbol";
                    break;
                case "fullouterjoin":
                    node.name = node.tag;
                    node.symbol = "full-join-symbol";
                    break;
                case "tablescan":
                    node.name = node.properties.from ? node.properties.from : node.tag;
                    node.symbol = "table-symbol";
                    break;
                case "binaryscan":
                case "cursorscan":
                case "csvscan":
                case "tdescan":
                case "tableconstruction":
                case "virtualtable":
                    node.name = node.tag;
                    node.symbol = "table-symbol";
                    break;
                case "explicitscan":
                    node.name = node.tag;
                    node.symbol = "temp-table-symbol";
                    break;
                case "temp":
                    node.name = node.tag;
                    node.symbol = "temp-table-symbol";
                    node.edgeClass = "qg-link-and-arrow";
                    break;
                case "comparison":
                    node.name = node.properties.mode ? node.properties.mode : node.tag;
                    break;
                case "iuref":
                    node.name = node.properties.iu ? node.properties.iu : node.tag;
                    break;
                case "attribute":
                case "condition":
                case "header":
                case "iu":
                case "name":
                case "operation":
                case "source":
                case "tableOid":
                case "tid":
                case "tupleFlags":
                case "unique":
                case "unnormalizedNames":
                case "output":
                    if (node.text) {
                        node.name = node.tag + ":" + node.text;
                    } else {
                        node.name = node.tag;
                    }
                    break;
                default:
                    if (node.tag) {
                        node.name = node.tag;
                    } else if (node.text) {
                        node.name = node.text;
                    } else {
                        node.name = "";
                    }
                    break;
            }
        },
        treeDescription.allChildren,
    );
}

// Function to add crosslinks between related nodes
function addCrosslinks(root: TreeNode) {
    interface UnresolvedCrosslink {
        source: TreeNode;
        optimizerStep: number;
        targetOpId: number;
    }

    const unresolvedLinks = [] as UnresolvedCrosslink[];
    const operatorsById = new Map<string, TreeNode>();
    let optimizerStep = 0;

    treeDescription.visitTreeNodes(
        root,
        function(node) {
            // Operators are only unique within an optimizer step
            if (node.tag !== undefined && node.tag.startsWith("optimizersteps")) {
                optimizerStep = parseInt(node.tag.split(".")[1], 10);
            }

            // Build map from operatorId to node
            if (node.hasOwnProperty("properties") && node.properties.hasOwnProperty("operatorId")) {
                const key = [parseInt(node.properties.operatorId, 10), optimizerStep].toString();
                operatorsById.set(key, node);
            }

            // Identify source operators
            switch (node.tag) {
                case "explicitscan":
                    if (node.hasOwnProperty("properties") && node.properties.hasOwnProperty("source")) {
                        unresolvedLinks.push({
                            source: node,
                            targetOpId: parseInt(node.properties.source, 10),
                            optimizerStep: optimizerStep,
                        });
                    }
                    break;
                case "earlyprobe":
                    if (node.hasOwnProperty("properties") && node.properties.hasOwnProperty("builder")) {
                        unresolvedLinks.push({
                            source: node,
                            targetOpId: parseInt(node.properties.builder, 10),
                            optimizerStep: optimizerStep,
                        });
                    }
                    break;
                default:
                    if (node.hasOwnProperty("properties") && node.properties.hasOwnProperty("magic")) {
                        unresolvedLinks.push({
                            source: node,
                            targetOpId: parseInt(node.properties.magic, 10),
                            optimizerStep: optimizerStep,
                        });
                    }
                    break;
            }
        },
        treeDescription.allChildren,
    );

    // Add crosslinks from source to matching target node
    const crosslinks = [] as Crosslink[];
    for (const link of unresolvedLinks) {
        const target = operatorsById.get([link.targetOpId, link.optimizerStep].toString());
        if (target !== undefined) {
            crosslinks.push({source: link.source, target: target});
        }
    }
    return crosslinks;
}

// Loads a Hyper query plan
export function loadHyperPlan(json: Json, graphCollapse: any = undefined): TreeDescription {
    // Extract top-level meta data
    const properties: any = {};
    if (hasSubOject(json, "plan")) {
        if (hasOwnProperty(json.plan, "header") && Array.isArray(json.plan.header)) {
            properties.columns = json.plan.header.length / 2;
        }
    }
    // Load the graph with the nodes collapsed in an automatic way
    const root = convertHyper(json, "result");
    if (Array.isArray(root)) {
        throw new Error("Invalid Hyper query plan");
    }
    generateDisplayNames(root);
    treeDescription.createParentLinks(root);
    // Adjust the graph so it is collapsed as requested by the user
    if (graphCollapse === "y") {
        treeDescription.visitTreeNodes(root, treeDescription.collapseAllChildren, treeDescription.allChildren);
    } else if (graphCollapse === "n") {
        treeDescription.visitTreeNodes(root, treeDescription.expandAllChildren, treeDescription.allChildren);
    }
    // Add crosslinks
    const crosslinks = addCrosslinks(root);
    return {root: root, crosslinks: crosslinks, properties: properties};
}

// Load a JSON tree from text
export function loadHyperPlanFromText(graphString: string, graphCollapse): TreeDescription {
    // Parse the plan as JSON
    let json: Json;
    try {
        json = JSON.parse(graphString);
    } catch (err) {
        throw new Error("JSON parse failed with '" + err + "'.");
    }
    return loadHyperPlan(json, graphCollapse);
}
