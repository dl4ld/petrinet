const async = require('async');

function retryFunction(f, n, t) {
        let c = 0
        const i = setInterval(() => {
                if(f("bar") || (c >= n-1)) {
                        clearInterval(i);
                }
		c++;
        }, t)
}

//retryFunction(function(l) {
//	console.log(`try ${l}`)
//	return false;
//}, 3, 1000)


async.retry({times:3, interval:1000}, function(cb) {
	console.log(`try `)
	cb(null, 1)
})

async function foo() {
	console.log('foo');
}

foo()


function koo(a,b) {
	console.log("koo a: ", a.x)
	console.log("koo b: ", b)
}

function wrap(x, ...args) {
	koo(...args)
}

wrap(1, {x:1}, 3)
