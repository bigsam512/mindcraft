import * as world from "./world.js";
import { log, wait, placeBlock, goToPosition } from "./skills.js";
import Vec3 from 'vec3';

// Helper functions (ordered by dependency)
async function equipItem(bot, itemName, hand = 'hand') {
    const item = bot.inventory.findInventoryItem(itemName, null);
    if (item) {
        try {
            await bot.equip(item, hand);
            log(bot, `Successfully equipped ${itemName} to ${hand}`);
            return true;
        } catch (e) {
            log(bot, `Error equipping ${itemName} to ${hand}: ${e}`);
            return false;
        }
    } else {
        log(bot, `No ${itemName} found in inventory.`);
        return false;
    }
}

async function placeOnBlock(bot, itemName, coords, directionVec = new Vec3(0, 1, 0), facingDirection = null) {
    if (!bot.origin) {
        log(bot, "Origin not set. Setting origin to current current position.");
        await setOrigin(bot);
    }
    const [x, y, z] = coords;
    const absX = bot.origin.position.x + x;
    const absY = bot.origin.position.y + y;
    const absZ = bot.origin.position.z - z; // Positive Z now means forward (negative world Z)

    const block = bot.blockAt(new Vec3(absX, absY, absZ));
    if (!block) {
        log(bot, `(${absX.toFixed(1)},${absY.toFixed(1)},${absZ.toFixed(1)}) No supporting block, cannot place ${itemName}`);
        return false;
    }
    
    if (!await equipItem(bot, itemName, 'hand')) {
        log(bot, `Cannot equip ${itemName}.`);
        return false;
    }

    // New logic to handle block facing direction
    if (facingDirection) {
        let lookAtTarget;
        const headPos = bot.entity.position.plus(new Vec3(0, bot.entity.height, 0));
        switch (facingDirection) {
            case 'north': lookAtTarget = headPos.plus(new Vec3(0, 0, -1)); break;
            case 'south': lookAtTarget = headPos.plus(new Vec3(0, 0, 1)); break;
            case 'east':  lookAtTarget = headPos.plus(new Vec3(1, 0, 0)); break;
            case 'west':  lookAtTarget = headPos.plus(new Vec3(-1, 0, 0)); break;
            case 'up':    lookAtTarget = headPos.plus(new Vec3(0, 1, 0)); break;
            case 'down':  lookAtTarget = headPos.plus(new Vec3(0, -1, 0)); break;
            default: log(bot, `Invalid facingDirection: ${facingDirection}. Ignoring.`);
        }
        if (lookAtTarget) {
            log(bot, `Looking ${facingDirection} to place block.`);
            await bot.lookAt(lookAtTarget);
            await wait(bot, 200); // Wait for the server to register the new look direction
        }
    }

    const maxRetries = 3;
    const skipAirCheck = true;

    if (!skipAirCheck) {
        const targetPos = new Vec3(absX + directionVec.x, absY + directionVec.y, absZ + directionVec.z);
        const targetBlock = bot.blockAt(targetPos);
        if (targetBlock && targetBlock.name !== 'air') {
            log(bot, `Warning: Target insertion position occupied by ${targetBlock.name}, cannot insert!`);
            return false;
        }
    }

    for (let retry = 0; retry < maxRetries; retry++) {
        try {
            await bot.placeBlock(block, directionVec);
            log(bot, `Successfully placed ${itemName} at ${block.position} in direction ${directionVec}`);
            return true;
        } catch (e) {
            if (e.message && e.message.includes("blockUpdate")) {
                log(bot, `Placed ${itemName} successfully, but no blockUpdate event received (can ignore this error), details: ${e.message}`);
                return true;
            } else {
                log(bot, `Attempt ${retry + 1} to place ${itemName} failed: ${e.message}`);
            }
        }
    }
    return false;
}

async function pourWaterInHole(bot, dx, dy, dz) {
    log(bot, `Pouring water at relative coords (${dx},${dy},${dz})`);

    if (!bot.origin) {
        log(bot, "Origin not set. Setting origin to current position.");
        await setOrigin(bot);
    }

    // Calculate the world coordinates for the target
    const yaw = bot.origin.yaw;
    const forwardVec = new Vec3(0, 0, -1);
    const rightVec = new Vec3(1, 0, 0);

    const lookAtPoint = bot.origin.position.clone()
        .add(rightVec.scaled(dx))
        .add(new Vec3(0, dy, 0))
        .add(forwardVec.scaled(dz));

    try {
        // 1. Equip the water bucket.
        if (!await equipItem(bot, 'water_bucket', 'hand')) {
            log(bot, "Cannot equip water_bucket.");
            return false;
        }
        log(bot, "Equipped water bucket.");

        // 2. Look at the target point to pour water.
        log(bot, `Looking at target point ${lookAtPoint.x.toFixed(1)}, ${lookAtPoint.y.toFixed(1)}, ${lookAtPoint.z.toFixed(1)} to pour water...`);
        await bot.lookAt(lookAtPoint);
        await wait(bot, 200); // Give bot time to look

        // 3. Activate the item (water bucket) to pour water.
        await bot.activateItem();
        log(bot, "✅ Successfully poured water into the hole.");
        await wait(bot, 1000); // Wait a bit for the water to flow

        return true;
    } catch (e) {
        log(bot, `❌ Error pouring water: ${e}`);
        return false;
    }
}

async function setOrigin(bot) {
    /**
     * Sets the bot's current position and yaw as the origin for relative coordinates.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     */
    bot.origin = {
        position: bot.entity.position.clone(),
        yaw: bot.entity.yaw
    };
    log(bot, `Origin set to ${bot.origin.position} with yaw ${bot.origin.yaw}`);
    return true;
}

async function walkTo(bot, dx, dy, dz) {
    /**
     * Navigates to a position relative to the bot's set origin.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} dx, the relative x coordinate (right).
     * @param {number} dy, the relative y coordinate (up).
     * @param {number} dz, the relative z coordinate (forward).
     */
    if (!bot.origin) {
        log(bot, "Origin not set. Setting origin to current position.");
        await setOrigin(bot);
    }

    const targetPos = new Vec3(
        bot.origin.position.x + dx,
        bot.origin.position.y + dy,
        bot.origin.position.z - dz
    );

    log(bot, `Going to relative coords (${dx},${dy},${dz}) -> world coords (${targetPos.x.toFixed(1)}, ${targetPos.y.toFixed(1)}, ${targetPos.z.toFixed(1)})`);
    return await goToPosition(bot, targetPos.x, targetPos.y, targetPos.z);
}

async function acquireItems(bot) {
    /**
     * Checks for a list of required items and gives them to the bot if they are missing.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the items were acquired, false otherwise.
     * @example
     * await skills.acquireItems(bot);
     **/
    const requiredItems = {
        'rail': 1,
        'smooth_stone': 8,
        'piston': 2,
        'observer': 1,
        'redstone': 5,
        'hopper_minecart': 1,
        'redstone_torch': 2,
        'repeater': 1,
        'lever': 1,
    };

    log(bot, "Checking and acquiring necessary items...");

    for (const itemName in requiredItems) {
        const requiredAmount = requiredItems[itemName];
        const currentAmount = world.getInventoryCounts(bot)[itemName] || 0;

        if (currentAmount < requiredAmount) {
            const amountToGive = requiredAmount - currentAmount;
            log(bot, `Inventory has ${currentAmount} of ${itemName}, need ${requiredAmount}. Giving ${amountToGive}.`);
            bot.chat(`/give @s ${itemName} ${amountToGive}`);
            await wait(bot, 200); // Wait a bit for the command to process
        } else {
            log(bot, `Already have enough ${itemName}.`);
        }
    }
    log(bot, "Finished acquiring items.");
    return true;
}

async function jumpForDuration(bot, duration) {
    /**
     * Jumps repeatedly for a given duration.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} duration, the duration to jump for in milliseconds.
     * @returns {Promise<boolean>} true if the bot jumped, false otherwise.
     * @example
     * await skills.jumpForDuration(bot, 5000);
     **/
    log(bot, `Bot will jump for ${duration / 1000} seconds.`);
    const endTime = Date.now() + duration;
    while (Date.now() < endTime) {
        if (bot.interrupt_code) {
            log(bot, "Jumping interrupted.");
            break;
        }
        bot.setControlState('jump', true);
        await wait(bot, 100); // Keep jump pressed for a short time
        bot.setControlState('jump', false);
        await wait(bot, 100); // Wait before next jump
    }
    bot.setControlState('jump', false); // Ensure it's off
    log(bot, "Bot stopped jumping.");
    return true;
}

async function walkNorth(bot, steps) {
    /**
     * Walks a certain number of steps (blocks) to the north.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} steps, the number of blocks to walk north.
     * @returns {Promise<boolean>} true if the bot moved, false otherwise.
     * @example
     * await skills.walkNorth(bot, 10);
     **/
    const currentPos = bot.entity.position;
    const targetZ = currentPos.z - steps; // North is negative Z

    log(bot, `Walking north ${steps} blocks...`);
    return await goToPosition(bot, currentPos.x, currentPos.y, targetZ, 1);
}

async function toggleBlock(bot, blockType, x, y, z) {
    log(bot, `Attempting to toggle ${blockType} at relative coords (${x}, ${y}, ${z})`);
    if (!bot.origin) {
        log(bot, "Origin not set. Setting origin to current position.");
        await setOrigin(bot);
    }
    const origin = bot.origin.position;

    const abs_x = origin.x + x;
    const abs_y = origin.y + y;
    const abs_z = origin.z - z;

    const pos = new Vec3(abs_x, abs_y, abs_z).floored();
    const block = bot.blockAt(pos);

    if (block && block.name === blockType) {
        try {
            await bot.activateBlock(block);
            log(bot, `Successfully activated ${blockType} at ${pos}`);
        } catch (e) {
            log(bot, `Error activating block at ${pos}: ${e.message}`);
        }
    } else {
        log(bot, `Block ${blockType} not found at relative coords (${x}, ${y}, ${z}) -> world coords ${pos}. Found ${block?.name || 'nothing'}.`);
    }
}

async function dig(bot, blocks_to_dig = []) {
    // Digs a pit based on a list of relative coordinates.
    log(bot, "Digging based on coordinate list...");
    if (!bot.origin) {
        log(bot, "Origin not set. Setting origin to current position.");
        await setOrigin(bot); // Make sure origin is set
    }
    const origin = bot.origin.position;

    for (const offset of blocks_to_dig) {
        const [rel_x, rel_y, rel_z] = offset;

        const abs_x = origin.x + rel_x;
        const abs_y = origin.y + rel_y;
        const abs_z = origin.z - rel_z; // The convention from placeOnBlock

        const pos_to_dig = new Vec3(abs_x, abs_y, abs_z).floored();
        const block = bot.blockAt(pos_to_dig);

        if (block && bot.canDigBlock(block) && block.name !== 'air') {
            log(bot, `Digging block at relative coords (${rel_x}, ${rel_y}, ${rel_z}) -> world coords ${pos_to_dig}`);
            try {
                await bot.dig(block);
            } catch (e) {
                log(bot, `Could not dig block at ${pos_to_dig}: ${e.message}`);
            }
        } else {
            log(bot, `Cannot dig block at ${pos_to_dig}. Block is ${block?.name || 'out of sight'}`);
        }
    }
}

// Main function (exported)
export async function makeRailMachine(bot) {
    await jumpForDuration(bot, 5000);
    await walkNorth(bot, 10);
    await acquireItems(bot);
    await setOrigin(bot);

    // A 2x3x1 pit, starting 1 block forward and 1 block down.
    const blocks_to_dig = [
        [0, -1, 1], [0, -1, 2], [0, -1, 3],
        [1, -1, 1], [1, -1, 2], [1, -1, 3],[-1, -1, 3]
    ];
    await dig(bot, blocks_to_dig);
    await walkTo(bot, -2, 0, 3);
    await placeOnBlock(bot, "piston", [-1, -2, 3]);
    await placeOnBlock(bot, "smooth_stone", [0, -2, 3]);
    await walkTo(bot, 2, 0, 3);
    await placeOnBlock(bot, "redstone_torch", [0, -1, 3], new Vec3(1, 0, 0));
    await placeOnBlock(bot, "smooth_stone", [1, -1, 3]);
    await placeOnBlock(bot, "redstone_torch", [1, 0, 3]);
    await placeOnBlock(bot, "smooth_stone", [1, 1, 3]);
    await placeOnBlock(bot, "smooth_stone", [1, 2, 3], new Vec3(-1, 0, 0));
    await placeOnBlock(bot, "smooth_stone", [0, 2, 3], new Vec3(-1, 0, 0));
    await placeOnBlock(bot, "smooth_stone", [-1, 2, 3]);
    await placeOnBlock(bot, "smooth_stone", [-1, 3, 3]);
    await placeOnBlock(bot, "redstone", [1, 2, 3]);
    await placeOnBlock(bot, "redstone", [0, 2, 3]);
    await walkTo(bot, -1, 0, 3);
    const blocks_to_dig_sky = [
        [-1, 2, 3], [-1, 3, 3]
    ];
    await dig(bot, blocks_to_dig_sky);
    await placeOnBlock(bot, "piston", [-1, 4, 3], new Vec3(0, -1, 0));
    await placeOnBlock(bot, "redstone", [1, -2, 2]);
    await placeOnBlock(bot, "redstone", [1, -2, 1]);
    await placeOnBlock(bot, "redstone", [0, -2, 1]);
    await walkTo(bot, 0, 0, 0);
    await placeOnBlock(bot, "repeater", [0, -2, 2]);
    await placeOnBlock(bot, "lever", [1, 0, 3], new Vec3(0, 0, 1));
    await toggleBlock(bot, "lever", 1, 0, 2);
    await toggleBlock(bot, "repeater", 0, -1, 2);
    await placeOnBlock(bot, "smooth_stone", [-1, -1, 2]);
    await walkTo(bot, -1, 1, 2);
    await placeOnBlock(bot, "observer", [-1, 0, 3], new Vec3(0, 1, 0), 'down');
    await placeOnBlock(bot, "rail", [-1, 1, 3]);
    await placeOnBlock(bot, "hopper_minecart", [-1, 2, 3]);
    await walkTo(bot, 0, 0, 0);
    await toggleBlock(bot, "lever", 1, 0, 2);
    return

//    bot.setControlState('sneak', true);
//    await placeOnBlock(bot, "powered_rail", [-2, 0, 3]);
//    bot.setControlState('sneak', false);

}
