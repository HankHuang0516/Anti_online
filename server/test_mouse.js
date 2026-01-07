const { mouse, straightTo, Point } = require('@nut-tree-fork/nut-js');

(async () => {
    console.log("Starting Mouse Test...");
    console.log("Current Position:", await mouse.getPosition());

    console.log("Moving to (100, 100)...");
    await mouse.move(straightTo(new Point(100, 100)));

    console.log("Moving to (500, 500)...");
    await mouse.move(straightTo(new Point(500, 500)));

    console.log("Drawing a small square...");
    await mouse.move(straightTo(new Point(500, 600)));
    await mouse.move(straightTo(new Point(600, 600)));
    await mouse.move(straightTo(new Point(600, 500)));
    await mouse.move(straightTo(new Point(500, 500)));

    console.log("Mouse Test Complete!");
})();
