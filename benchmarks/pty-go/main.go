// Minimal Linux PTY spawn probe for the architecture comparison.
//
// This measures only the native terminal primitive: one Go parent starts an
// interactive bash per terminal through github.com/creack/pty. It is not a
// complete HTTP/WebSocket server.
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/creack/pty"
)

type child struct {
	cmd *exec.Cmd
	pty *os.File
}

func main() {
	count := flag.Int("count", 50, "number of interactive shells")
	hold := flag.Duration("hold", 5*time.Second, "how long to keep them alive")
	flag.Parse()

	started := time.Now()
	children := make([]child, 0, *count)
	var readers sync.WaitGroup
	for i := 0; i < *count; i++ {
		cmd := exec.Command("/bin/bash", "-i")
		terminal, err := pty.Start(cmd)
		if err != nil {
			panic(err)
		}
		children = append(children, child{cmd: cmd, pty: terminal})
		readers.Add(1)
		go func(file *os.File) {
			defer readers.Done()
			_, _ = io.Copy(io.Discard, file)
		}(terminal)
	}
	spawnMs := float64(time.Since(started).Microseconds()) / 1000
	time.Sleep(*hold)
	for _, item := range children {
		_ = item.cmd.Process.Kill()
		_ = item.pty.Close()
		_, _ = item.cmd.Process.Wait()
	}
	readers.Wait()
	fmt.Printf("{\"count\":%d,\"spawnMs\":%.3f,\"holdMs\":%d,\"binary\":\"go + creack/pty + /bin/bash\"}\n", *count, spawnMs, hold.Milliseconds())
}
